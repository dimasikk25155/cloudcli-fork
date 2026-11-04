/**
 * «Контекст и лимиты» for one chat, the same for every engine.
 *
 * Inputs are what Neo3 already serves: the session's token-usage payload
 * (`used` = last context occupancy, the number TokenUsageSummary divides),
 * the selected model's `contextWindow` from the provider catalog, and the
 * body of `GET /api/usage/limits` (Claude: `usage.fiveHour/sevenDay`,
 * Codex with `?provider=codex`: `codex.windows`). Anything an engine does
 * not report stays `null` — never 0 and never another engine's numbers.
 * Grok does not report subscription limits: `known: false`, no windows.
 */

export type ProviderLimitWindow = {
  label: string;
  /** Percent used, 0..100; null — unknown. */
  utilization: number | null;
  resetsAt: string | null;
};

export type ProviderLimits = {
  context: { usedPct: number | null; used: number | null; window: number | null };
  windows: ProviderLimitWindow[];
  /** The engine reports subscription limits at all (Claude, Codex). */
  known: boolean;
};

export type ProviderLimitsRaw = {
  tokenUsage?: Record<string, unknown> | null;
  contextWindow?: number | null;
  limits?: unknown;
};

const FIVE_HOURS_MIN = 300;
const WEEK_MIN = 10_080;

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function windowLabel(minutes: number | null): string {
  if (minutes === FIVE_HOURS_MIN) return '5 часов';
  if (minutes === WEEK_MIN) return 'Неделя';
  if (minutes === null) return 'Окно';
  if (minutes % 1440 === 0) return `${minutes / 1440} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч`;
  return `${minutes} мин`;
}

function readWindow(label: string, raw: unknown): ProviderLimitWindow {
  const value = record(raw);
  return { label, utilization: count(value?.utilization), resetsAt: text(value?.resetsAt) };
}

function claudeWindows(limits: unknown): ProviderLimitWindow[] {
  const usage = record(record(limits)?.usage);
  return [readWindow('5 часов', usage?.fiveHour), readWindow('Неделя', usage?.sevenDay)];
}

function codexWindows(limits: unknown): ProviderLimitWindow[] {
  const windows = record(record(limits)?.codex)?.windows;
  if (!Array.isArray(windows)) return [];
  return windows.map((raw) => readWindow(windowLabel(count(record(raw)?.windowMinutes)), raw));
}

export function normalizeProviderLimits(provider: string | null | undefined, raw: ProviderLimitsRaw): ProviderLimits {
  const used = count(raw.tokenUsage?.used);
  const window = count(raw.contextWindow);
  const usedPct = used !== null && window !== null && window > 0 ? Math.round((used / window) * 1000) / 10 : null;
  const context = { usedPct, used, window };
  if (provider === 'claude') return { context, windows: claudeWindows(raw.limits), known: true };
  if (provider === 'codex') return { context, windows: codexWindows(raw.limits), known: true };
  return { context, windows: [], known: false };
}
