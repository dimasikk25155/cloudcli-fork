import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { parseAttachedFilesTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import { buildRunInterruptedNotice, readRunOutcome } from '@/shared/run-outcomes.js';
import { getContextWindow } from '@/shared/token-pricing.js';
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

const PROVIDER = 'grok';

/**
 * Sessions provider for the Grok Build CLI (xAI).
 *
 * Two event dialects are handled here (both verified against grok 1.0.5):
 *
 * 1. LIVE — stdout of `grok -p --output-format streaming-messages-json`, one
 *    JSON object per line in the Anthropic Messages API wire format:
 *      {"type":"system","subtype":"init","session_id":..,"model":..,
 *       "tools":[..],"mcp_servers":[{"name":..,"status":"connected"}]}
 *      {"type":"assistant","message":{"role":"assistant","content":[
 *        {"type":"thinking","thinking":".."} | {"type":"text","text":".."} |
 *        {"type":"tool_use","id":"call-..","name":"read_file","input":{..}}]}}
 *      {"type":"user","message":{"role":"user","content":[
 *        {"type":"tool_result","tool_use_id":"call-..","content":".."}]}}
 *      {"type":"result","subtype":"success"|"error_during_execution",
 *       "is_error":bool,"stop_reason":"end_turn"|"cancelled","usage":{..},
 *       "result":"final text"}
 *
 * 2. HISTORY — ~/.grok/sessions/<url-encoded cwd>/<uuid>/chat_history.jsonl,
 *    a flatter dialect written by the CLI itself:
 *      {"type":"system","content":".."}                      prompt preamble
 *      {"type":"user","content":[{"type":"text","text":".."}]}
 *      {"type":"reasoning","summary":[{"type":"summary_text","text":".."}]}
 *      {"type":"assistant","content":"..","tool_calls":[
 *        {"id":"call-..","name":"read_file","arguments":"<json string>"}]}
 *      {"type":"tool_result","tool_call_id":"call-..","content":".."}
 */

/**
 * The CLI wraps every first prompt in a context envelope (`<user_info>`,
 * `<rules>`, `<user_query>`). Only the query itself is chat content; the rest
 * is machinery the user never typed.
 */
const extractUserQuery = (text: string): string => {
  const queryMatch = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }
  if (text.includes('<user_info>') || text.includes('<system-reminder>')) {
    return '';
  }
  return text.trim();
};

/**
 * User-visible turn: the `<user_query>` body minus the `<images_input>` /
 * `<attached_files>` blocks the gateway appends so the model can name a file.
 * Those tags used to leak into the chat bubble because Grok history stores
 * them inside the query, unlike Claude/Cursor which strip on read.
 *
 * Exported for tests.
 */
export function extractGrokUserTurn(text: string): {
  text: string;
  images?: Array<{ path: string; name?: string }>;
} {
  const query = extractUserQuery(text);
  if (!query) {
    return { text: '' };
  }

  // Work-mode rules ride inside the prompt because grok's --rules flag never
  // reaches the model (see embedGrokRulesInPrompt in server/grok-cli.js).
  // They are app machinery, not something the user typed — strip them from
  // the visible bubble exactly like <images_input>.
  const withoutRules = query.replace(/<work_mode_rules>[\s\S]*?<\/work_mode_rules>\s*/g, '');

  const imagesParsed = parseImagesInputTag(withoutRules);
  const filesParsed = parseAttachedFilesTag(imagesParsed.text);
  const attachments = [...imagesParsed.attachments, ...filesParsed.files];
  return {
    text: filesParsed.text.trim(),
    images: attachments.length > 0 ? attachments : undefined,
  };
}

/** Live stream: non-null `parent_tool_use_id` is a subagent, not the main chat. */
const isSubagentEvent = (raw: AnyRecord): boolean => (
  typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.trim().length > 0
);

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

/** `tool_calls[].arguments` is a JSON string on the history dialect. */
const parseToolArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
};

const readNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Turns a `result` event's usage payload into the same token-budget shape the
 * Claude runtime emits, so the composer's token badge works unchanged.
 */
const buildTokenBudget = (usage: AnyRecord, model: string | null): AnyRecord => {
  const cacheCreationTokens = readNumber(usage.cache_creation_input_tokens);
  const cacheReadTokens = readNumber(usage.cache_read_input_tokens);
  const cacheTokens = cacheCreationTokens + cacheReadTokens;
  const inputTokens = readNumber(usage.input_tokens) + cacheTokens;
  const outputTokens = readNumber(usage.output_tokens);

  return {
    used: inputTokens + outputTokens,
    total: getContextWindow(model),
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
  };
};

export class GrokSessionsProvider implements IProviderSessions {
  /**
   * Model id per live session, captured from the `system/init` event.
   *
   * The `result` event carries the usage payload but NOT the model, and the
   * context window is a function of the model — without this the token badge
   * would report a 0-token window. Keyed by session id (concurrent runs never
   * collide) and dropped as soon as the run's `result` arrives.
   */
  private readonly modelBySession = new Map<string, string>();

  /**
   * Sessions that already produced at least one assistant text block during
   * the live run. If a run ends without any (all the answer text arrived only
   * in the final `result.result` field), that field becomes the chat bubble —
   * otherwise the chat would end on silence while the CLI did answer.
   */
  private readonly sessionsWithAssistantText = new Set<string>();

  /**
   * Live streaming-messages-json events from the runner.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    // Subagent chatter shares the same assistant/user stream. Dumping it into
    // the main transcript interleaves three agents' tokens into one bubble.
    if (isSubagentEvent(raw)) {
      return [];
    }

    // Session bootstrap (model, tools, connected MCP servers) — the runner
    // already knows the session id, so there is no UI payload here, but the
    // model is remembered for the token budget at the end of the run.
    // `subtype: compact_boundary` is Grok's auto-compaction marker, not chat.
    if (raw.type === 'system') {
      if (sessionId && typeof raw.model === 'string' && raw.model.trim()) {
        this.modelBySession.set(sessionId, raw.model);
      }
      return [];
    }

    if (raw.type === 'assistant') {
      const message = readObjectRecord(raw.message);
      const content = message?.content;
      if (!Array.isArray(content)) {
        return [];
      }

      const messages: NormalizedMessage[] = [];
      for (const part of content) {
        const block = readObjectRecord(part);
        if (!block) {
          continue;
        }

        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          if (sessionId) {
            this.sessionsWithAssistantText.add(sessionId);
          }
          messages.push(createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            sessionId,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: block.text,
          }));
          continue;
        }

        if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
          messages.push(createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            sessionId,
            provider: PROVIDER,
            kind: 'thinking',
            content: block.thinking,
          }));
          continue;
        }

        if (block.type === 'tool_use' && block.id && block.name) {
          messages.push(createNormalizedMessage({
            id: `${String(block.id)}_call`,
            sessionId,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: String(block.name),
            toolInput: block.input,
            toolId: String(block.id),
          }));
        }
      }

      return messages;
    }

    if (raw.type === 'user') {
      const message = readObjectRecord(raw.message);
      const content = message?.content;
      if (!Array.isArray(content)) {
        return [];
      }

      const messages: NormalizedMessage[] = [];
      for (const part of content) {
        const block = readObjectRecord(part);
        if (!block || block.type !== 'tool_result') {
          continue;
        }
        const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
        if (!toolId) {
          continue;
        }

        messages.push(createNormalizedMessage({
          id: `${toolId}_result`,
          sessionId,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
        }));
      }

      return messages;
    }

    if (raw.type === 'result') {
      const messages: NormalizedMessage[] = [];

      const model = typeof raw.model === 'string' && raw.model.trim()
        ? raw.model
        : (sessionId ? this.modelBySession.get(sessionId) ?? null : null);
      if (sessionId) {
        this.modelBySession.delete(sessionId);
      }

      // Fallback answer text: a run that streamed no assistant text block but
      // did put the final answer into `result.result` must not end silent.
      const sawAssistantText = sessionId ? this.sessionsWithAssistantText.delete(sessionId) : false;
      if (
        raw.is_error !== true
        && !sawAssistantText
        && typeof raw.result === 'string'
        && raw.result.trim()
      ) {
        messages.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          sessionId,
          provider: PROVIDER,
          kind: 'text',
          role: 'assistant',
          content: raw.result,
        }));
      }

      const usage = readObjectRecord(raw.usage);
      if (usage) {
        messages.push(createNormalizedMessage({
          sessionId,
          provider: PROVIDER,
          kind: 'status',
          text: 'token_budget',
          tokenBudget: buildTokenBudget(usage, model),
        }));
      }

      // A headless run that hits a permission gate ends as
      // error_during_execution/cancelled with no answer text — surface that
      // instead of letting the chat end on silence.
      if (raw.is_error === true) {
        const stopReason = typeof raw.stop_reason === 'string' ? raw.stop_reason : 'unknown';
        const detail = stopReason === 'cancelled'
          ? 'Grok остановил прогон: инструмент упёрся в ограничение прав. В режиме «Планирование» это штатная остановка — агент только планирует и ничего не меняет; чтобы он выполнил работу, выбери «Обход разрешений» и отправь сообщение снова.'
          : `Grok завершился с ошибкой (${stopReason}).`;
        messages.push(createNormalizedMessage({
          sessionId,
          provider: PROVIDER,
          kind: 'error',
          content: detail,
        }));
      }

      return messages;
    }

    return [];
  }

  /**
   * Full session history parsed from the CLI's chat_history.jsonl transcript.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let rawEvents: AnyRecord[] = [];
    try {
      rawEvents = await this.readHistoryEvents(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[GrokProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawEvents) {
      normalized.push(...this.normalizeHistoryEvent(raw, sessionId));
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

    // If the last run for this session failed and the transcript never closed
    // with an assistant answer (it ends on a tool call/thinking), append a
    // durable "run interrupted" marker with the reason — same contract as the
    // Claude history reader, fed by recordRunOutcome in grok-cli.js.
    try {
      const providerSessionId = options.providerSessionId
        ?? sessionsDb.getSessionById(sessionId)?.provider_session_id
        ?? sessionId;
      const outcome = await readRunOutcome(providerSessionId);
      if (outcome?.status === 'failed') {
        const last = normalized[normalized.length - 1];
        const endedWithoutAnswer =
          !last || last.kind === 'tool_use' || last.kind === 'tool_result' || last.kind === 'thinking';
        if (endedWithoutAnswer) {
          normalized.push(createNormalizedMessage({
            id: `${providerSessionId}_run_interrupted_${outcome.at}`,
            sessionId,
            timestamp: outcome.at,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: buildRunInterruptedNotice(outcome.reason),
          }));
        }
      }
    } catch {
      // Never let outcome lookup break history loading.
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

  /**
   * chat_history.jsonl dialect — flatter than the live stream.
   */
  private normalizeHistoryEvent(raw: AnyRecord, sessionId: string): NormalizedMessage[] {
    // The system prompt preamble is machinery, not conversation.
    if (raw.type === 'system') {
      return [];
    }

    if (raw.type === 'user') {
      const turn = extractGrokUserTurn(readTextParts(raw.content));
      if (!turn.text && !turn.images?.length) {
        return [];
      }
      return [createNormalizedMessage({
        id: generateMessageId(PROVIDER),
        sessionId,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content: turn.text,
        images: turn.images,
      })];
    }

    if (raw.type === 'reasoning') {
      const summary = Array.isArray(raw.summary) ? raw.summary : [];
      const text = summary
        .map((part) => {
          const record = readObjectRecord(part);
          return record && typeof record.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n');
      if (!text.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: generateMessageId(PROVIDER),
        sessionId,
        provider: PROVIDER,
        kind: 'thinking',
        content: text,
      })];
    }

    if (raw.type === 'assistant') {
      const messages: NormalizedMessage[] = [];

      if (typeof raw.content === 'string' && raw.content.trim()) {
        messages.push(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
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
          if (!record?.id || !record?.name) {
            continue;
          }
          messages.push(createNormalizedMessage({
            id: `${String(record.id)}_call`,
            sessionId,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: String(record.name),
            toolInput: parseToolArguments(record.arguments),
            toolId: String(record.id),
          }));
        }
      }

      return messages;
    }

    if (raw.type === 'tool_result') {
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

  private async readHistoryEvents(sessionId: string): Promise<AnyRecord[]> {
    const historyPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
    if (!historyPath || !fsSync.existsSync(historyPath)) {
      return [];
    }

    const events: AnyRecord[] = [];
    const rl = readline.createInterface({
      input: fsSync.createReadStream(historyPath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const record = readObjectRecord(JSON.parse(trimmed) as unknown);
        if (record) {
          events.push(record);
        }
      } catch {
        // Skip malformed lines from concurrent writes.
      }
    }

    return events;
  }
}
