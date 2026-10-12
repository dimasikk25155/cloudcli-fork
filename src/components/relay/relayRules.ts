/**
 * Relay ("перенести в новый чат") — the pure rules: when the band shows,
 * how "not now" postpones it, and how the handoff path is read from the
 * agent's last reply. No React, no network: the hook and the band use these.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Context is "full enough" at this share of the selected model's window… */
export const RELAY_CONTEXT_PERCENT = 50;
/** …or at this many occupied tokens, whatever the window. */
export const RELAY_CONTEXT_TOKENS = 400_000;
/** A chat this old is offered a relay regardless of its context. */
export const RELAY_AGE_HOURS = 12;
/** "Not now" hides the band until the context grows by this many points… */
export const RELAY_SNOOZE_PERCENT = 10;
/** …(or this many tokens when the window is unknown)… */
export const RELAY_SNOOZE_TOKENS = 100_000;
/** …or the chat ages this many more hours. */
export const RELAY_SNOOZE_HOURS = 6;

/** What the chat looked like when the user pressed "Не сейчас". */
export type RelayDismissal = {
  contextPercent: number | null;
  usedTokens: number | null;
  ageHours: number | null;
};

export type RelaySuggestionInput = {
  /** Latest occupied context (TokenUsageSummary's numerator); null = unknown. */
  usedTokens: number | null | undefined;
  /** Selected model's window (TokenUsageSummary's denominator); null = unknown. */
  contextWindow: number | null | undefined;
  /** Session creation time (ISO / SQLite / ms); null = unknown. */
  createdAt: string | number | null | undefined;
  now: number;
  dismissed?: RelayDismissal | null;
};

export type RelayReason = 'context' | 'age';
export type RelaySuggestionVerdict = { show: boolean; reason: RelayReason | null };

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Latest occupied context from a token-usage payload — the same `used` that
 * TokenUsageSummary divides by the model window. Cumulative billing counters
 * (inputTokens / outputTokens) and the runtime `total` are never used here.
 */
export function contextOccupancy(usage: Record<string, unknown> | null | undefined): number | null {
  return finite(usage?.used);
}

/** Milliseconds since epoch for an ISO / SQLite ("YYYY-MM-DD HH:MM:SS", UTC) / numeric timestamp. */
export function parseSessionTime(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed);
  const parsed = Date.parse(sqlite ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The numbers the rule compares; also what "Не сейчас" stores. */
export function relayMeasures(input: Omit<RelaySuggestionInput, 'dismissed'>): RelayDismissal {
  const used = finite(input.usedTokens);
  const window = finite(input.contextWindow);
  const created = parseSessionTime(input.createdAt);
  return {
    usedTokens: used,
    contextPercent: used !== null && window !== null && window > 0 ? (used / window) * 100 : null,
    ageHours: created !== null ? Math.max(0, (input.now - created) / HOUR_MS) : null,
  };
}

function contextDue(measures: RelayDismissal, dismissed: RelayDismissal | null | undefined): boolean {
  const { usedTokens, contextPercent } = measures;
  const reached = (contextPercent !== null && contextPercent >= RELAY_CONTEXT_PERCENT)
    || (usedTokens !== null && usedTokens >= RELAY_CONTEXT_TOKENS);
  if (!reached || !dismissed) {
    return reached;
  }
  if (contextPercent !== null && dismissed.contextPercent !== null) {
    return contextPercent >= dismissed.contextPercent + RELAY_SNOOZE_PERCENT;
  }
  if (usedTokens !== null && dismissed.usedTokens !== null) {
    return usedTokens >= dismissed.usedTokens + RELAY_SNOOZE_TOKENS;
  }
  return true;
}

function ageDue(measures: RelayDismissal, dismissed: RelayDismissal | null | undefined): boolean {
  const { ageHours } = measures;
  if (ageHours === null || ageHours < RELAY_AGE_HOURS) {
    return false;
  }
  if (!dismissed || dismissed.ageHours === null) {
    return true;
  }
  return ageHours >= dismissed.ageHours + RELAY_SNOOZE_HOURS;
}

/**
 * Shows the band when the context is ≥50% of the model window or ≥400K
 * tokens, or the chat is ≥12 h old. After "Не сейчас" each criterion comes
 * back only past its own next step (+10 points / +6 h from the dismissal),
 * so dismissing for age never postpones the first context threshold.
 */
export function relaySuggestion(input: RelaySuggestionInput): RelaySuggestionVerdict {
  const measures = relayMeasures(input);
  if (contextDue(measures, input.dismissed)) {
    return { show: true, reason: 'context' };
  }
  if (ageDue(measures, input.dismissed)) {
    return { show: true, reason: 'age' };
  }
  return { show: false, reason: null };
}

const HANDOFF_LINE = /^[\s>*_`"']*HANDOFF_FILE[*_`]*\s*:[*_`]*\s*(.*)$/;
const DRESSING = /^[\s`"'*]+|[\s`"'*]+$/g;

/**
 * The path the agent printed as `HANDOFF_FILE: <path>` — the LAST such line
 * of the reply (a line, not a mention mid-sentence). Markdown dressing
 * (backticks, bold, quotes) around the line or the path is dropped; spaces
 * inside the path are kept. Null when there is no usable line.
 */
export function parseHandoffFile(reply: string | null | undefined): string | null {
  if (typeof reply !== 'string' || !reply) {
    return null;
  }
  const lines = reply.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = HANDOFF_LINE.exec(lines[index]);
    if (!match) {
      continue;
    }
    const value = match[1].replace(DRESSING, '');
    if (value) {
      return value;
    }
  }
  return null;
}

/** Tag that marks one relay request; the reply to it is recognised by it. */
export function relayRequestTag(nonce: string): string {
  return `эстафета ${nonce}`;
}

/**
 * The plain-text request (no slash command — Claude, Codex and Grok all take
 * it the same way) sent to the current chat by «Перенести».
 */
export function buildRelayRequest(nonce: string): string {
  return [
    `Переносим работу в новый чат (${relayRequestTag(nonce)}).`,
    'Собери эстафету навыком handoff и запиши записку в файл docs/handoff/<дата>-<коротко-о-задаче>.md в корне этого проекта. Папку docs/handoff/ создай, если её нет, даже когда в проекте нет docs/ (запасной .handoff/ здесь не нужен). Не коммить и ни о чём не спрашивай.',
    'Последней строкой ответа выведи путь к записке в формате «HANDOFF_FILE: <путь>» — без кавычек и другого текста в этой строке.',
  ].join('\n');
}

/** First message of the continuation chat. */
export function buildRelayFirstMessage(handoffPath: string): string {
  return `Прочитай ${handoffPath} и продолжай работу с того места`;
}
