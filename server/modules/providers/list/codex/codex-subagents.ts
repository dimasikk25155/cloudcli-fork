import type { NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

type AgentState = { status: string; message?: string | null };
type CollabItem = {
  id: string;
  tool: string;
  prompt?: string;
  receiver_thread_ids?: string[];
  agents_states?: Record<string, AgentState>;
  status?: string;
};

function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function toolKind(name: unknown): string {
  return typeof name === 'string' ? name.replace(/^(?:functions\.)?collaboration\./, '') : '';
}

/** Only typed transport records are accepted, never ordinary assistant/user prose. */
export function codexHelperPayload(event: unknown): Record<string, any> | null {
  const raw = object(event);
  const payload = ['response_item', 'event_msg'].includes(raw.type) ? object(raw.payload) : raw;
  const item = object(payload.item);
  if (['SubAgentActivity', 'subagent_activity'].includes(item.type)) return item;
  if (['SubAgentActivity', 'subagent_activity'].includes(payload.type)) return payload;
  if (payload.type === 'agent_message' && typeof payload.author === 'string' && typeof payload.recipient === 'string') return payload;
  if (item.type === 'agent_message' && typeof item.author === 'string' && typeof item.recipient === 'string') return item;
  return null;
}

/** Spawn completion means the helper started, not that its work finished. */
export class CodexSubagentTracker {
  private calls = new Map<string, string>();
  private previousCalls = new Map<string, string>();
  private tools = new Map<string, { kind: string; input: Record<string, any> }>();
  private started = new Set<string>();
  private finished = new Map<string, { status: string; summary: string }>();
  private seenRecords = new Set<string>();

  event(item: CollabItem, sessionId: string | null, model?: string): NormalizedMessage[] {
    const rows: NormalizedMessage[] = [];
    if (item.tool === 'spawn_agent') {
      if (!this.started.has(item.id)) {
        this.started.add(item.id);
        rows.push(createNormalizedMessage({
          id: item.id, toolId: item.id, sessionId, provider: 'codex', kind: 'tool_use',
          toolName: 'spawn_agent',
          toolInput: { prompt: item.prompt, description: item.prompt?.split('\n')[0]?.slice(0, 100), model, run_in_background: true },
        }));
      }
      for (const child of item.receiver_thread_ids ?? []) this.calls.set(child, item.id);
      if (item.status === 'failed') rows.push(...this.finish(item.id, 'failed', '', sessionId));
    }
    for (const [child, state] of Object.entries(item.agents_states ?? {})) {
      const call = this.calls.get(child);
      if (!call) continue;
      if (state.status === 'completed') rows.push(...this.finish(call, 'completed', state.message ?? '', sessionId));
      else if (['errored', 'interrupted', 'shutdown', 'not_found'].includes(state.status)) rows.push(...this.finish(call, 'failed', state.message ?? '', sessionId));
    }
    return rows;
  }

  /** The same reducer serves persisted history and normalized live tool rows. */
  message(message: NormalizedMessage): NormalizedMessage[] {
    if (message.codexHelper) return this.record(object(message.codexHelper), message.sessionId, message.id, message.timestamp);
    const kind = toolKind(message.toolName);
    if (message.kind === 'tool_use' && message.toolId) {
      const input = object(message.toolInput);
      this.tools.set(message.toolId, { kind, input });
      if (kind === 'spawn_agent' || kind === 'followup_task') {
        this.started.add(message.toolId);
        if (kind === 'followup_task' && typeof input.target === 'string') {
          const previous = this.resolve(input.target);
          if (previous && previous !== message.toolId) {
            this.previousCalls.set(message.toolId, previous);
            for (const [alias, call] of this.calls) if (call === previous) this.calls.set(alias, message.toolId);
          }
        }
        return [{ ...message, toolName: 'spawn_agent', toolInput: { ...input, run_in_background: true } }];
      }
    }
    if (message.kind !== 'tool_result' || !message.toolId) return [message];
    const tool = this.tools.get(message.toolId);
    const output = object(message.content);
    const extra: NormalizedMessage[] = [];
    if (tool?.kind === 'spawn_agent' || tool?.kind === 'followup_task') {
      for (const child of [output.agent_id, output.task_name]) if (typeof child === 'string') this.calls.set(child, message.toolId);
      if (message.isError) extra.push(...this.finish(message.toolId, 'failed', String(message.content ?? ''), message.sessionId));
    } else if (tool?.kind === 'wait' || tool?.kind === 'wait_agent') {
      for (const [child, value] of Object.entries(object(output.status))) {
        const call = this.resolve(child);
        if (!call) continue;
        const state = object(value);
        if (typeof state.completed === 'string') extra.push(...this.finish(call, 'completed', state.completed, message.sessionId));
        else if ('errored' in state || ['shutdown', 'not_found', 'interrupted'].includes(String(value))) extra.push(...this.finish(call, 'failed', '', message.sessionId));
      }
    }
    return [message, ...extra.map(row => ({ ...row, timestamp: message.timestamp }))];
  }

  private resolve(child: string): string | undefined {
    const exact = this.calls.get(child);
    if (exact || child.startsWith('/')) return exact;
    const matches = [...this.calls].filter(([name]) => name.endsWith(`/${child}`));
    return matches.length === 1 ? matches[0][1] : undefined;
  }

  record(payload: Record<string, any>, sessionId: string | null, recordId: string, timestamp?: string, callPrefix = ''): NormalizedMessage[] {
    if (this.seenRecords.has(recordId)) return [];
    this.seenRecords.add(recordId);
    let rows: NormalizedMessage[] = [];
    if (['SubAgentActivity', 'subagent_activity'].includes(payload.type)) {
      const id = callPrefix + payload.id;
      if (payload.kind === 'started') {
        for (const child of [payload.agent_path, payload.agent_thread_id]) if (typeof child === 'string') this.calls.set(child, id);
        if (!this.started.has(id)) rows = this.event({ id, tool: 'spawn_agent', receiver_thread_ids: [payload.agent_path, payload.agent_thread_id].filter(v => typeof v === 'string') }, sessionId, payload.model);
      } else if (payload.kind === 'interacted') {
        // send_message also emits interacted; only followup_task starts a new cycle.
        if (this.tools.get(id)?.kind === 'followup_task') for (const child of [payload.agent_path, payload.agent_thread_id]) if (typeof child === 'string') this.calls.set(child, id);
      } else if (['completed', 'errored', 'failed', 'interrupted'].includes(payload.kind)) {
        const call = this.resolve(payload.agent_path ?? '') ?? this.resolve(payload.agent_thread_id ?? '');
        if (call) rows = this.finish(call, payload.kind === 'completed' ? 'completed' : 'failed', '', sessionId);
      }
    } else if (payload.type === 'agent_message') {
      const activeCall = this.resolve(payload.author ?? '');
      const call = activeCall ? this.finalCall(activeCall) : undefined;
      const text = Array.isArray(payload.content) ? payload.content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n') : '';
      const match = /^Message Type: FINAL_ANSWER\r?\nTask name: ([^\r\n]+)\r?\nSender: ([^\r\n]+)\r?\nPayload:\s*([\s\S]*)$/.exec(text);
      if (call && match && match[1] === payload.recipient && match[2] === payload.author) rows = this.finish(call, 'completed', match[3], sessionId);
    }
    return timestamp ? rows.map(row => ({ ...row, timestamp })) : rows;
  }

  private finalCall(activeCall: string): string {
    // FINAL_ANSWER identifies the helper, not its cycle. Preserve completed
    // cycles waiting for that separate envelope across followup alias changes.
    let result = activeCall;
    let previous = this.previousCalls.get(activeCall);
    const seen = new Set([activeCall]);
    while (previous && !seen.has(previous)) {
      seen.add(previous);
      const ending = this.finished.get(previous);
      if (ending?.status === 'completed' && !ending.summary) result = previous;
      previous = this.previousCalls.get(previous);
    }
    return result;
  }

  private finish(toolId: string, status: string, summary: string, sessionId: string | null): NormalizedMessage[] {
    const previous = this.finished.get(toolId);
    if (previous && (previous.summary || !summary || previous.status !== status)) return [];
    this.finished.set(toolId, { status, summary });
    return [createNormalizedMessage({ id: `${toolId}_subagent_return`, toolId, sessionId, provider: 'codex', kind: 'task_notification', status, summary })];
  }
}

/** Reconstruct helper endings after reloading a Codex JSONL transcript. */
export function codexSubagentHistory(messages: NormalizedMessage[]): NormalizedMessage[] {
  const tracker = new CodexSubagentTracker();
  const result: NormalizedMessage[] = [];
  const indexes = new Map<string, number>();
  for (const message of messages) {
    for (const row of tracker.message(message)) {
      const index = indexes.get(row.id);
      if (index === undefined) { indexes.set(row.id, result.length); result.push(row); }
      else result[index] = row;
    }
  }
  return result;
}
