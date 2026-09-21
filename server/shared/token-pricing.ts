/**
 * Single source of truth for "what would this have cost on the API" and "how
 * big is this model's context window".
 *
 * Two things the UI could not answer before this module existed:
 *   1. Token counts alone are meaningless as a cost signal — ~97% of a typical
 *      agent session is cache-read, billed at 0.1x the fresh-input rate. A
 *      naive `tokens * input_rate` estimate overstates the bill by ~10x.
 *   2. The context badge divided by a hardcoded 160K window, while the models
 *      actually in use have a 1M window — so "how full is my context" was
 *      unanswerable.
 *
 * Rates are USD per 1M tokens, first-party Anthropic API pricing.
 * Cache multipliers (relative to the model's input rate) are uniform across
 * models: read = 0.1x, 5-minute write = 1.25x, 1-hour write = 2x.
 */

export type ModelRates = {
  /** USD per 1M fresh input tokens. */
  input: number;
  /** USD per 1M generated output tokens. */
  output: number;
  /** Context window in tokens. */
  contextWindow: number;
  /**
   * USD per 1M cache-read tokens. When omitted, billed at 0.1× the fresh
   * input rate (Anthropic). Grok publishes an absolute cache price instead.
   */
  cacheRead?: number;
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

/** Fast mode (Opus 5 / Opus 4.8) runs the same model at premium rates. */
const FAST_MODE_RATES: ModelRates = { input: 10, output: 50, contextWindow: 1_000_000 };

/**
 * Longest-prefix match wins, so `claude-opus-5` and a dated/suffixed variant
 * (`claude-opus-5-fast`, `us.anthropic.claude-opus-5`) both resolve.
 * Non-Anthropic engines (Kimi) intentionally carry a window but no price —
 * we do not invent rates for a subscription we don't bill through.
 */
const MODEL_RATES: Array<[prefix: string, rates: ModelRates | null, window: number]> = [
  // Anthropic — priced
  ['claude-fable-5', { input: 10, output: 50, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-mythos-5', { input: 10, output: 50, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-mythos-preview', { input: 10, output: 50, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-opus-5', { input: 5, output: 25, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-opus-4-8', { input: 5, output: 25, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-opus-4-7', { input: 5, output: 25, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-opus-4-6', { input: 5, output: 25, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-opus-4-5', { input: 5, output: 25, contextWindow: 200_000 }, 200_000],
  ['claude-opus-4-1', { input: 15, output: 75, contextWindow: 200_000 }, 200_000],
  ['claude-opus-4', { input: 15, output: 75, contextWindow: 200_000 }, 200_000],
  ['claude-sonnet-5', { input: 2, output: 10, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-sonnet-4-6', { input: 3, output: 15, contextWindow: 1_000_000 }, 1_000_000],
  ['claude-sonnet-4-5', { input: 3, output: 15, contextWindow: 200_000 }, 200_000],
  ['claude-sonnet-4', { input: 3, output: 15, contextWindow: 200_000 }, 200_000],
  ['claude-haiku-4-5', { input: 1, output: 5, contextWindow: 200_000 }, 200_000],
  ['claude-3-7-sonnet', { input: 3, output: 15, contextWindow: 200_000 }, 200_000],
  ['claude-3-5-haiku', { input: 0.8, output: 4, contextWindow: 200_000 }, 200_000],
  // Non-Anthropic engines routed through this app — window only, no pricing.
  // Both entries match the UI catalog id AND the native id the gateway wants
  // (`minimax-m3` / `MiniMax-M3[1m]`, `glm-5-2` / `GLM-5.2`), since either can
  // reach this module depending on whether the alias was already resolved.
  ['minimax', null, 1_000_000],
  ['glm-', null, 1_000_000],
  ['kimi', null, 256_000],
  ['k3', null, 256_000],
  ['k2', null, 256_000],
  ['gpt-', null, 400_000],
  ['o3', null, 200_000],
  ['gemini', null, 1_000_000],
  // Grok — published API rates (docs.x.ai/developers/pricing, 24.08.2026;
  // 4.7 announced 21.09.2026 at the same $2/$6 as 4.6; the CLI's model cache
  // labels `grok-4.7-build-fast` "Fast variant. 2x the price").
  // Native CLI ids arrive as `grok-4.7-build` / `grok-4.7-build-fast`;
  // longest prefix still wins.
  ['grok-4.7-build-fast', { input: 4, output: 12, contextWindow: 500_000, cacheRead: 1.00 }, 500_000],
  ['grok-4.7', { input: 2, output: 6, contextWindow: 500_000, cacheRead: 0.50 }, 500_000],
  ['grok-4.6', { input: 2, output: 6, contextWindow: 500_000, cacheRead: 0.50 }, 500_000],
  ['grok-4.5', { input: 2, output: 6, contextWindow: 500_000, cacheRead: 0.30 }, 500_000],
  ['grok-4.3', { input: 1.25, output: 2.50, contextWindow: 1_000_000 }, 1_000_000],
  ['grok-build-0.1', { input: 1, output: 2, contextWindow: 256_000 }, 256_000],
  ['grok', { input: 2, output: 6, contextWindow: 500_000, cacheRead: 0.50 }, 500_000],
];

/**
 * Catalog values the model picker stores (`opus[1m]`, `sonnet[1m]`, `fable`, `haiku`)
 * are not API model ids, so they miss the prefix table entirely. Whenever one
 * reaches this module — a session model override, a resumed run, a transcript
 * that recorded the alias rather than the resolved id — an unmapped alias used
 * to collapse to the fallback and the badge announced a 200K window for a 1M
 * model. The `[1m]` suffix is handled on its own below, since it *means* the
 * 1M-context variant no matter which model carries it.
 */
const MODEL_ALIASES: Record<string, string> = {
  // `fable` is the CLI's "newest Fable" alias — Fable 5.1 since 09.2026.
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

const ONE_MILLION_SUFFIX = '[1m]';

function normaliseModel(model: string | null | undefined): string {
  if (!model || typeof model !== 'string') {
    return '';
  }
  // Strip provider prefixes (`anthropic.`, `us.anthropic.`) so Bedrock/Vertex
  // ids match the same table as first-party ones.
  const id = model.toLowerCase().replace(/^(us|eu|apac)\./, '').replace(/^anthropic\./, '');
  const bare = id.endsWith(ONE_MILLION_SUFFIX)
    ? id.slice(0, -ONE_MILLION_SUFFIX.length)
    : id;
  return MODEL_ALIASES[bare] ?? bare;
}

function lookup(model: string | null | undefined): { rates: ModelRates | null; window: number } | null {
  const id = normaliseModel(model);
  if (!id) {
    return null;
  }

  let best: { rates: ModelRates | null; window: number; length: number } | null = null;
  for (const [prefix, rates, window] of MODEL_RATES) {
    if (id.startsWith(prefix) && (!best || prefix.length > best.length)) {
      best = { rates, window, length: prefix.length };
    }
  }

  return best ? { rates: best.rates, window: best.window } : null;
}

/**
 * Context window for a model id, used as the denominator of the context badge.
 *
 * Returns 0 when the model is unknown or not yet reported (a fresh session has
 * no assistant message to read a model from). Callers treat 0 as "no window":
 * the badge then shows the raw token count with no denominator. The old
 * behaviour — defaulting to 200K — looked conservative but simply lied on a 1M
 * model, and the lie was loud: a normal 222K turn rendered as "111%" in red.
 * An unknown window is better shown as unknown than as a wrong number.
 */
export function getContextWindow(model: string | null | undefined): number {
  const explicitOneMillion = typeof model === 'string'
    && model.toLowerCase().endsWith(ONE_MILLION_SUFFIX);
  return lookup(model)?.window ?? (explicitOneMillion ? 1_000_000 : 0);
}

/** True when we have real published rates for this model. */
export function isPricedModel(model: string | null | undefined): boolean {
  return Boolean(lookup(model)?.rates);
}

export type TokenBreakdown = {
  /** Fresh (uncached) input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Cache writes with the 5-minute TTL (1.25x input rate). */
  cacheWrite5mTokens: number;
  /** Cache writes with the 1-hour TTL (2x input rate). */
  cacheWrite1hTokens: number;
};

export type CostEstimate = {
  /** Total USD this usage would cost at published API rates. */
  totalUsd: number;
  /** Per-bucket USD, so the UI can show where the money actually goes. */
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
};

export const EMPTY_BREAKDOWN: TokenBreakdown = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

/**
 * What this usage would have cost on the API. Returns null for models we have
 * no published rates for — a missing number is honest, a guessed one is not.
 *
 * `speed: 'fast'` selects the Opus fast-mode premium rates ($10/$50).
 */
export function estimateCostUsd(
  breakdown: TokenBreakdown,
  model: string | null | undefined,
  options: { speed?: string | null } = {},
): CostEstimate | null {
  const entry = lookup(model);
  if (!entry?.rates) {
    return null;
  }

  const rates = options.speed === 'fast' ? FAST_MODE_RATES : entry.rates;
  const perToken = rates.input / 1_000_000;

  const inputUsd = breakdown.inputTokens * perToken;
  const outputUsd = (breakdown.outputTokens * rates.output) / 1_000_000;
  const cacheReadUsd = rates.cacheRead != null
    ? (breakdown.cacheReadTokens * rates.cacheRead) / 1_000_000
    : breakdown.cacheReadTokens * perToken * CACHE_READ_MULTIPLIER;
  const cacheWriteUsd =
    breakdown.cacheWrite5mTokens * perToken * CACHE_WRITE_5M_MULTIPLIER +
    breakdown.cacheWrite1hTokens * perToken * CACHE_WRITE_1H_MULTIPLIER;

  return {
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
  };
}

/**
 * Reads the cache-creation split out of a Claude `message.usage` row.
 * Recent transcripts carry `cache_creation: { ephemeral_5m_input_tokens,
 * ephemeral_1h_input_tokens }`; older ones only have the flat
 * `cache_creation_input_tokens`, which we bill at the 5-minute rate.
 */
export function readCacheCreationSplit(usage: Record<string, any> | null | undefined): {
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
} {
  const num = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const detail = usage?.cache_creation;
  if (detail && typeof detail === 'object') {
    const fiveMin = num(detail.ephemeral_5m_input_tokens);
    const oneHour = num(detail.ephemeral_1h_input_tokens);
    if (fiveMin > 0 || oneHour > 0) {
      return { cacheWrite5mTokens: fiveMin, cacheWrite1hTokens: oneHour };
    }
  }

  // Older schema: no TTL split available — assume the cheaper 5-minute write.
  return {
    cacheWrite5mTokens: num(usage?.cache_creation_input_tokens ?? usage?.cacheCreationInputTokens ?? usage?.cacheCreationTokens),
    cacheWrite1hTokens: 0,
  };
}

export type UsageBreakdown = {
  /** Uncached prompt tokens. */
  freshInput: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

const EMPTY_USAGE_BREAKDOWN: UsageBreakdown = {
  freshInput: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

/**
 * Normalises a usage row from Claude (snake_case, fresh input) or Grok
 * (camelCase; `inputTokens` already includes cache reads).
 *
 * Using Grok's `inputTokens` as fresh input would bill cache at the full
 * input rate and also paint the context badge at 500%+ of the 500K window.
 */
export function readUsageBreakdown(usage: Record<string, unknown> | null | undefined): UsageBreakdown {
  if (!usage || typeof usage !== 'object') {
    return { ...EMPTY_USAGE_BREAKDOWN };
  }

  const num = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const cacheRead = num(
    usage.cache_read_input_tokens
      ?? usage.cacheReadInputTokens
      ?? usage.cachedReadTokens
      ?? usage.inputCacheRead,
  );
  const output = num(usage.output_tokens ?? usage.outputTokens ?? usage.output);
  const rawInput = num(usage.input_tokens ?? usage.inputTokens ?? usage.inputOther);
  const split = readCacheCreationSplit(usage);
  // Grok native `turn_completed.usage` has no snake_case `input_tokens` and
  // `inputTokens` is the inclusive prompt (fresh + cache). Anthropic rows
  // always carry `input_tokens` as the uncached slice.
  const grokNativeInclusive = usage.input_tokens == null
    && usage.cachedReadTokens != null
    && cacheRead > 0
    && rawInput >= cacheRead;

  return {
    freshInput: grokNativeInclusive ? Math.max(0, rawInput - cacheRead) : rawInput,
    output,
    cacheRead,
    cacheWrite5m: split.cacheWrite5mTokens,
    cacheWrite1h: split.cacheWrite1hTokens,
  };
}

/** How many tokens this row occupies as a context-window snapshot. */
export function usageFootprint(row: UsageBreakdown): number {
  return row.freshInput + row.output + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h;
}

export function toTokenBreakdown(row: UsageBreakdown): TokenBreakdown {
  return {
    inputTokens: row.freshInput,
    outputTokens: row.output,
    cacheReadTokens: row.cacheRead,
    cacheWrite5mTokens: row.cacheWrite5m,
    cacheWrite1hTokens: row.cacheWrite1h,
  };
}
