import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { parseAttachedFilesTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import { buildRunInterruptedNotice, readRunOutcome } from '@/shared/run-outcomes.js';
import { getContextWindow, readUsageBreakdown } from '@/shared/token-pricing.js';
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
 * Clock for history rows. chat_history.jsonl has no per-event timestamps, so
 * we interpolate from session start → file mtime. Stamping everything `now()`
 * made an old "привет" look like the message just sent, and the live bubble
 * disappeared.
 */
export function resolveGrokHistoryClock(
  historyPath: string | null | undefined,
  createdAt: string | null | undefined,
  messageCount: number,
): { startMs: number; endMs: number } {
  const now = Date.now();
  let endMs = now;
  let birthMs = Number.NaN;

  if (historyPath) {
    try {
      const stats = fsSync.statSync(historyPath);
      if (Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0) {
        endMs = stats.mtimeMs;
      }
      if (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0) {
        birthMs = stats.birthtimeMs;
      }
    } catch {
      // Keep the fallback clock below.
    }
  }

  const createdMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  const startCandidates = [birthMs, createdMs].filter((value) => Number.isFinite(value) && value > 0 && value <= endMs);
  let startMs = startCandidates.length > 0 ? Math.min(...startCandidates) : Number.NaN;
  if (!Number.isFinite(startMs)) {
    startMs = endMs - Math.max(messageCount - 1, 0) * 1000;
  }
  if (startMs > endMs) {
    startMs = endMs;
  }
  return { startMs, endMs };
}

/**
 * Stable ids + interpolated clocks for a parsed Grok transcript.
 * Tool rows keep their `toolId`-based ids so results still fold onto calls.
 */
export function stampGrokHistoryMessages(
  messages: NormalizedMessage[],
  sessionId: string,
  clock: { startMs: number; endMs: number },
): void {
  const count = messages.length;
  if (count === 0) {
    return;
  }
  const span = Math.max(0, clock.endMs - clock.startMs);
  for (let index = 0; index < count; index += 1) {
    const message = messages[index];
    const at = count === 1
      ? clock.endMs
      : clock.startMs + Math.round(span * (index / (count - 1)));
    message.timestamp = new Date(at).toISOString();
    if (message.kind === 'tool_use' || message.kind === 'tool_result') {
      continue;
    }
    message.id = `grok_hist_${sessionId}_${index}_${message.kind}_${message.role || 'none'}`;
  }
}

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
/**
 * Grok injects MCP connect/disconnect banners as if they were a new user
 * turn. That both paints junk in the chat and aborts the running agent.
 * Treat the banner as harness noise, never as conversation.
 */
export function isGrokHarnessNoise(text: string): boolean {
  const raw = (text || '').trim();
  if (!raw) {
    return false;
  }
  const stripped = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    // Status line plus the following "- server" bullets. The connecting
    // variant has a parenthetical before the colon ("currently connecting
    // (tools will become available shortly):"), so we cannot require `:`
    // immediately after the status word.
    .replace(/MCP servers [^\n]*(?:\n-[^\n]*)*/gi, ' ')
    .replace(/To use MCP tools, you MUST call[^\n]*/gi, ' ')
    .replace(/Do not attempt to use tools from these servers yet[^\n]*/gi, ' ')
    .replace(/If the user's request likely requires one of these servers[^\n]*/gi, ' ')
    .replace(/NEVER guess parameter names[^\n]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length === 0;
}

/**
 * Grok CLI 1.0.13+ injects Stop-hook / reminder rows as fake user turns
 * (`synthetic_reason: "stop_hook_feedback"`). Same contract as Claude's
 * `isMeta` rows: the model must see them, the chat must not.
 */
export function isGrokSyntheticUserTurn(raw: AnyRecord): boolean {
  return typeof raw.synthetic_reason === 'string' && raw.synthetic_reason.trim().length > 0;
}

/** Native Stop-hook text Grok writes when it continues the turn itself. */
export function isGrokStopHookFeedbackText(text: string): boolean {
  const trimmed = (text || '').trim();
  return /^Stop hook feedback:/i.test(trimmed)
    || /^This is an automatic follow-up from a session Stop hook/i.test(trimmed);
}

const extractUserQuery = (text: string): string => {
  const queryMatch = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }
  if (text.includes('<user_info>') || text.includes('<system-reminder>')) {
    return '';
  }
  const trimmed = text.trim();
  if (isGrokHarnessNoise(trimmed)) {
    return '';
  }
  return trimmed;
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

  // Work-mode rules and hook context ride inside the prompt because grok's
  // --rules flag never reaches the model and Claude-side hooks never run
  // (see embedGrokRulesInPrompt / collectGrokHookContext in server/grok-cli.js).
  // They are app machinery, not something the user typed — strip them from
  // the visible bubble exactly like <images_input>.
  const withoutRules = query
    .replace(/<work_mode_rules>[\s\S]*?<\/work_mode_rules>\s*/g, '')
    .replace(/<session_context>[\s\S]*?<\/session_context>\s*/g, '')
    .replace(/<session_followup>[\s\S]*?<\/session_followup>\s*/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '');

  const imagesParsed = parseImagesInputTag(withoutRules);
  const filesParsed = parseAttachedFilesTag(imagesParsed.text);
  const attachments = [...imagesParsed.attachments, ...filesParsed.files];
  const visibleText = filesParsed.text.trim();
  if (isGrokHarnessNoise(visibleText) || isGrokStopHookFeedbackText(visibleText)) {
    return { text: '', images: attachments.length > 0 ? attachments : undefined };
  }
  return {
    text: visibleText,
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

/**
 * Turns a `result` event's usage payload into the token-budget shape the
 * composer badge expects. `used` is the context-window footprint of this
 * event — never the sum of every model call in the turn. Grok's native
 * `inputTokens` already includes cache and is often several million; that
 * number is spend, not fill, so it must not become the badge denominator.
 */
const buildTokenBudget = (usage: AnyRecord, model: string | null): AnyRecord => {
  const row = readUsageBreakdown(usage);
  const window = getContextWindow(model);
  const cacheTokens = row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
  const used = null;

  return {
    used,
    total: window,
    model,
    inputTokens: row.freshInput + cacheTokens,
    outputTokens: row.output,
    cacheReadTokens: row.cacheRead,
    cacheCreationTokens: row.cacheWrite5m + row.cacheWrite1h,
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
      if (raw.subtype === 'compact_boundary') {
        return [createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: { used: null }, sessionId, provider: 'grok' })];
      }
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
          if (isGrokHarnessNoise(block.text)) {
            continue;
          }
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
      if (isGrokSyntheticUserTurn(raw)) {
        return [];
      }
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
        const resultText = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content ?? '');
        if (/No user is available to answer questions in this non-interactive session/i.test(resultText)) {
          continue;
        }

        messages.push(createNormalizedMessage({
          id: `${toolId}_result`,
          sessionId,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId,
          content: resultText,
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
        && !isGrokHarnessNoise(raw.result)
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
    const sessionRow = sessionsDb.getSessionById(sessionId);

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

    stampGrokHistoryMessages(
      normalized,
      sessionId,
      resolveGrokHistoryClock(sessionRow?.jsonl_path, sessionRow?.created_at, normalized.length),
    );

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
      if (raw.subtype === 'compact_boundary') {
        return [createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: { used: null }, sessionId, provider: 'grok' })];
      }
      return [];
    }

    if (raw.type === 'user') {
      if (isGrokSyntheticUserTurn(raw)) {
        return [];
      }
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
