/**
 * Prompt-cache timer («Кэш» chip in the composer, note in «Ждут тебя»).
 *
 * Claude Code writes the conversation into Anthropic's prompt cache with a
 * one-hour TTL; every model request refreshes it. While the cache is warm the
 * next message is cheap (cache read ≈ 10% of input); once it expires the whole
 * conversation is written again — many times more of the subscription limit.
 * The timer counts from the LAST model activity of the session (last
 * assistant message / end of the turn), never from the user's send.
 *
 * Pure functions only — no React, no browser APIs — so the boundaries are
 * unit-tested (promptCache.test.ts). No auto "warm-up" pings anywhere: that
 * would spend limit for nothing.
 */

/** Claude Code's prompt-cache lifetime in Neo3 sessions, minutes. */
export const DEFAULT_PROMPT_CACHE_TTL_MIN = 60;
/** Below this many minutes left the chip turns yellow. */
export const PROMPT_CACHE_WARN_MIN = 10;
/** Upper bound for an overridden TTL (one day) — anything above is a typo. */
const MAX_TTL_MIN = 24 * 60;
const MINUTE_MS = 60_000;

/** Plain-words explanation for the chip's tooltip / tap popover. */
export function promptCacheExplanation(ttlMin: number = DEFAULT_PROMPT_CACHE_TTL_MIN): string {
  const minutes = normalizePromptCacheTtl(ttlMin);
  return `Пока таймер не истёк, следующее сообщение дешёвое. После ${minutes} минут без ответа модели Claude заново загружает весь разговор — это стоит заметно больше лимита.`;
}

export type PromptCacheState = 'unknown' | 'running' | 'warm' | 'cooling' | 'cold';

export type PromptCacheStatus = {
  state: PromptCacheState;
  /** Whole minutes left, rounded up (warm/cooling only). */
  minutesLeft: number | null;
  /** Epoch ms when the cache expires (null while running or without data). */
  expiresAt: number | null;
};

/** A positive TTL in minutes (≤ 1 day), otherwise the 60-minute default. */
export function normalizePromptCacheTtl(value: unknown): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 && numeric <= MAX_TTL_MIN
    ? numeric
    : DEFAULT_PROMPT_CACHE_TTL_MIN;
}

/**
 * Remaining cache time for a session.
 *  - running turn → `running` (the turn itself keeps refreshing the cache);
 *  - no model activity known → `unknown`;
 *  - elapsed ≥ TTL → `cold`;
 *  - otherwise `warm`, or `cooling` when fewer than 10 whole minutes remain.
 */
export function promptCacheStatus(input: {
  lastModelAt: number | null | undefined;
  isRunning: boolean;
  now: number;
  ttlMin?: number;
}): PromptCacheStatus {
  if (input.isRunning) {
    return { state: 'running', minutesLeft: null, expiresAt: null };
  }
  const last = input.lastModelAt;
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) {
    return { state: 'unknown', minutesLeft: null, expiresAt: null };
  }
  const ttlMs = normalizePromptCacheTtl(input.ttlMin) * MINUTE_MS;
  const expiresAt = last + ttlMs;
  // A timestamp slightly in the future (clock skew) counts as "just now".
  const msLeft = Math.min(ttlMs, expiresAt - input.now);
  if (msLeft <= 0) {
    return { state: 'cold', minutesLeft: 0, expiresAt };
  }
  const minutesLeft = Math.ceil(msLeft / MINUTE_MS);
  return {
    state: minutesLeft < PROMPT_CACHE_WARN_MIN ? 'cooling' : 'warm',
    minutesLeft,
    expiresAt,
  };
}

/** Chip text: «Кэш 42 мин» / «Кэш остыл» / «Кэш: идёт ход»; null = no chip. */
export function promptCacheChipLabel(status: PromptCacheStatus): string | null {
  switch (status.state) {
    case 'running':
      return 'Кэш: идёт ход';
    case 'cold':
      return 'Кэш остыл';
    case 'warm':
    case 'cooling':
      return `Кэш ${status.minutesLeft} мин`;
    default:
      return null;
  }
}

/** Compact phone chip text: «42м» / «остыл» / «ход»; null = no chip. */
export function promptCacheCompactLabel(status: PromptCacheStatus): string | null {
  switch (status.state) {
    case 'running':
      return 'ход';
    case 'cold':
      return 'остыл';
    case 'warm':
    case 'cooling':
      return `${status.minutesLeft}м`;
    default:
      return null;
  }
}

/** Hub row note: «кэш остынет через N мин» / «кэш остыл»; null = no note. */
export function promptCacheHubNote(status: PromptCacheStatus): string | null {
  if (status.state === 'cold') {
    return 'кэш остыл';
  }
  if (status.state === 'warm' || status.state === 'cooling') {
    return `кэш остынет через ${status.minutesLeft} мин`;
  }
  return null;
}

/**
 * Whether the timer applies: Claude sessions on Anthropic models only. Codex
 * and Grok cache differently; local and third-party models run through the
 * Claude engine (`local-*`, MiniMax, GLM, Kimi) do not touch Anthropic's cache.
 */
export function promptCacheApplies(provider: string | null | undefined, model?: string | null): boolean {
  if (provider !== 'claude') {
    return false;
  }
  const id = (model ?? '').toLowerCase();
  return !(id.startsWith('local-') || id.startsWith('minimax') || id.startsWith('glm-') || id.includes('kimi'));
}

type ModelActivityMessage = { kind?: string; role?: string; timestamp?: unknown };

const MODEL_KINDS = new Set(['text', 'thinking', 'tool_use']);

/**
 * Epoch ms of the newest model output in a transcript: the last assistant
 * message of any kind — text, thinking or tool call, service turns included.
 * User messages, tool results and statuses are not model requests.
 */
export function lastModelActivityAt(messages: readonly ModelActivityMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const isModel = message.role === 'assistant'
      ? message.kind === undefined || MODEL_KINDS.has(message.kind)
      : message.kind === 'thinking' || message.kind === 'tool_use';
    if (!isModel) {
      continue;
    }
    const at = typeof message.timestamp === 'string' ? Date.parse(message.timestamp)
      : typeof message.timestamp === 'number' ? message.timestamp : NaN;
    if (Number.isFinite(at)) {
      return at;
    }
  }
  return null;
}

/** Newest of several sources (store transcript, server status); null when none. */
export function latestTimestamp(...values: Array<number | string | null | undefined>): number | null {
  let best: number | null = null;
  for (const value of values) {
    const at = typeof value === 'string' ? Date.parse(value) : value;
    if (typeof at === 'number' && Number.isFinite(at) && at > 0 && (best === null || at > best)) {
      best = at;
    }
  }
  return best;
}

// ── TTL from the server (`NEO3_PROMPT_CACHE_TTL_MIN`, delivered with GET /api/attention) ──

let serverTtlMin = DEFAULT_PROMPT_CACHE_TTL_MIN;

export function setPromptCacheTtlMin(value: unknown): void {
  serverTtlMin = normalizePromptCacheTtl(value);
}

export function getPromptCacheTtlMin(): number {
  return serverTtlMin;
}
