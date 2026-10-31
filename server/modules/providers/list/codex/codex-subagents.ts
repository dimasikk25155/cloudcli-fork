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

/** Spawn completion means the helper started, not that its work finished. */
export class CodexSubagentTracker {
  private calls = new Map<string, string>();
  private started = new Set<string>();
  private finished = new Set<string>();

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
      else if (['errored', 'interrupted', 'shutdown', 'not_found'].includes(state.status)) {
        rows.push(...this.finish(call, 'failed', state.message ?? '', sessionId));
      }
    }
    return rows;
  }

  private finish(toolId: string, status: string, summary: string, sessionId: string | null): NormalizedMessage[] {
    if (this.finished.has(toolId)) return [];
    this.finished.add(toolId);
    return [createNormalizedMessage({
      id: `${toolId}_subagent_return`, toolId, sessionId, provider: 'codex',
      kind: 'task_notification', status, summary,
    })];
  }
}

function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

/** Reconstruct native helper endings after reloading a Codex JSONL transcript. */
export function codexSubagentHistory(messages: NormalizedMessage[]): NormalizedMessage[] {
  const tracker = new CodexSubagentTracker();
  const tools = new Map<string, NormalizedMessage>();
  const result: NormalizedMessage[] = [];
  for (const message of messages) {
    result.push(message);
    if (message.kind === 'tool_use' && message.toolId) {
      tools.set(message.toolId, message);
      if (message.toolName === 'spawn_agent') {
        message.toolInput = { ...object(message.toolInput), run_in_background: true };
      }
    }
    if (message.kind !== 'tool_result' || !message.toolId) continue;
    const tool = tools.get(message.toolId);
    const output = object(message.content);
    if (tool?.toolName === 'spawn_agent') {
      const input = object(tool.toolInput);
      result.push(...tracker.event({
        id: message.toolId, tool: 'spawn_agent', prompt: input.message || input.prompt,
        receiver_thread_ids: typeof output.agent_id === 'string' ? [output.agent_id] : [],
        status: message.isError ? 'failed' : 'completed',
      }, message.sessionId).filter((row) => row.kind === 'task_notification').map((row) => ({ ...row, timestamp: message.timestamp })));
    } else if (tool?.toolName === 'wait' || tool?.toolName === 'wait_agent') {
      const states: Record<string, AgentState> = {};
      for (const [child, value] of Object.entries(object(output.status))) {
        const state = object(value);
        if (typeof state.completed === 'string') states[child] = { status: 'completed', message: state.completed };
        else if ('errored' in state || ['shutdown', 'not_found', 'interrupted'].includes(String(value))) states[child] = { status: 'errored' };
      }
      result.push(...tracker.event({ id: message.toolId, tool: 'wait', agents_states: states }, message.sessionId).map((row) => ({ ...row, timestamp: message.timestamp })));
    }
  }
  return result;
}
