import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'kimi';

/**
 * Sessions provider for the Kimi Code CLI.
 *
 * Two event dialects are handled here (both verified against kimi-code 0.29.0):
 *
 * 1. LIVE — stdout of `kimi -p --output-format stream-json`, one JSON object
 *    per line, OpenAI-flavoured:
 *      {"role":"assistant","content":"..."}                          text chunk
 *      {"role":"assistant","tool_calls":[{"type":"function","id":..,
 *        "function":{"name":"Bash","arguments":"<json string>"}}]}   tool call
 *      {"role":"tool","tool_call_id":"..","content":"..."}           tool result
 *      {"role":"meta","type":"session.resume_hint","session_id":..}  end-of-run
 *    The meta line carries no UI content — the runner uses it to capture the
 *    session id, normalizeMessage drops it.
 *
 * 2. HISTORY — ~/.kimi-code/sessions/<wd>/<id>/agents/main/wire.jsonl, the
 *    CLI's internal recovery trace. Relevant records:
 *      {"type":"context.append_message","message":{"role":"user",
 *        "content":[{"type":"text","text":...}],"origin":{"kind":"user"}}}
 *      {"type":"context.append_loop_event","event":{"type":"content.part",
 *        "part":{"type":"think"|"text", ...}}}
 *      {"type":"context.append_loop_event","event":{"type":"tool.call",
 *        "toolCallId":..,"name":..,"args":{..}}}
 *      {"type":"context.append_loop_event","event":{"type":"tool.result",
 *        "toolCallId":..,"result":{"output":...}}}
 */

/** User messages the CLI injects itself (mode reminders) are not chat content. */
const isVisibleUserText = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith('<system-reminder>');
};

const readTextParts = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      const record = readObjectRecord(part);
      return record && record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
};

export class KimiSessionsProvider implements IProviderSessions {
  /**
   * Live stream-json events from the runner.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // End-of-run metadata (session.resume_hint) — no UI payload.
    if (raw.role === 'meta') {
      return [];
    }

    if (raw.role === 'assistant') {
      const messages: NormalizedMessage[] = [];

      if (typeof raw.content === 'string' && raw.content.trim()) {
        messages.push(createNormalizedMessage({
          id: generateMessageId('kimi'),
          sessionId,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.content,
        }));
      }

      if (Array.isArray(raw.tool_calls)) {
        for (const call of raw.tool_calls) {
          const record = readObjectRecord(call);
          const fn = readObjectRecord(record?.function);
          if (!record?.id || !fn?.name) {
            continue;
          }

          let toolInput: unknown = fn.arguments;
          if (typeof fn.arguments === 'string') {
            try {
              toolInput = JSON.parse(fn.arguments);
            } catch {
              toolInput = { raw: fn.arguments };
            }
          }

          messages.push(createNormalizedMessage({
            id: `${String(record.id)}_call`,
            sessionId,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: String(fn.name),
            toolInput,
            toolId: String(record.id),
          }));
        }
      }

      return messages;
    }

    if (raw.role === 'tool') {
      const toolId = typeof raw.tool_call_id === 'string' ? raw.tool_call_id : null;
      if (!toolId) {
        return [];
      }

      return [createNormalizedMessage({
        id: `${toolId}_result`,
        sessionId,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId,
        content: typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content ?? ''),
      })];
    }

    return [];
  }

  /**
   * Full session history parsed from the CLI's wire.jsonl transcript.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let rawEvents: AnyRecord[] = [];
    try {
      rawEvents = await this.readWireEvents(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[KimiProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawEvents) {
      normalized.push(...this.normalizeWireEvent(raw, sessionId));
    }

    // Fold tool results into their tool_use rows, same as the other providers.
    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    const renderable = normalized.filter((msg) => msg.kind !== 'tool_result');

    const total = renderable.length;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(renderable, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }

  private async readWireEvents(sessionId: string): Promise<AnyRecord[]> {
    const wirePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
    if (!wirePath || !fsSync.existsSync(wirePath)) {
      return [];
    }

    const events: AnyRecord[] = [];
    const rl = readline.createInterface({
      input: fsSync.createReadStream(wirePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const event = JSON.parse(trimmed) as unknown;
        const record = readObjectRecord(event);
        if (record) {
          events.push(record);
        }
      } catch {
        // Skip malformed lines from concurrent writes.
      }
    }

    return events;
  }

  /**
   * Maps one wire.jsonl record onto UI messages (see the dialect notes above).
   */
  private normalizeWireEvent(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    if (raw.type === 'context.append_message') {
      const message = readObjectRecord(raw.message);
      if (!message || message.role !== 'user') {
        return [];
      }

      const text = readTextParts(message.content);
      if (!isVisibleUserText(text)) {
        return [];
      }

      return [createNormalizedMessage({
        id: generateMessageId('kimi'),
        sessionId,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content: text,
      })];
    }

    if (raw.type !== 'context.append_loop_event') {
      return [];
    }

    const event = readObjectRecord(raw.event);
    if (!event) {
      return [];
    }

    if (event.type === 'content.part') {
      const part = readObjectRecord(event.part);
      if (!part) {
        return [];
      }

      if (part.type === 'think' && typeof part.think === 'string' && part.think.trim()) {
        return [createNormalizedMessage({
          id: typeof event.uuid === 'string' ? event.uuid : generateMessageId('kimi'),
          sessionId,
          provider: PROVIDER,
          kind: 'thinking',
          content: part.think,
        })];
      }

      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        return [createNormalizedMessage({
          id: typeof event.uuid === 'string' ? event.uuid : generateMessageId('kimi'),
          sessionId,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: part.text,
        })];
      }

      return [];
    }

    if (event.type === 'tool.call') {
      const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : null;
      if (!toolId) {
        return [];
      }

      return [createNormalizedMessage({
        id: `${toolId}_call`,
        sessionId,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: typeof event.name === 'string' ? event.name : 'Tool',
        toolInput: event.args ?? {},
        toolId,
      })];
    }

    if (event.type === 'tool.result') {
      const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : null;
      if (!toolId) {
        return [];
      }

      const result = readObjectRecord(event.result);
      const output = result?.output ?? event.result;

      return [createNormalizedMessage({
        id: `${toolId}_result`,
        sessionId,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId,
        content: typeof output === 'string' ? output : JSON.stringify(output ?? ''),
        isError: Boolean(result?.isError ?? result?.is_error),
      })];
    }

    return [];
  }
}

// Re-exported for tests: the live-event guard helpers.
export { isVisibleUserText };
