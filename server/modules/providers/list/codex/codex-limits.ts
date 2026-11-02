import { readCodexRpc, type CodexReadRpcOptions } from './codex-rpc.js';

export type CodexLimitWindow = {
  utilization: number;
  windowMinutes: number;
  resetsAt: string | null;
};
export type CodexUsageSnapshot = {
  windows: CodexLimitWindow[];
  planType: string | null;
  fetchedAt: string;
};

/** Preserve the durations returned by Codex: primary is not always five hours. */
export function parseCodexLimits(result: any): CodexUsageSnapshot | null {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return null;
  const windows: CodexLimitWindow[] = [];
  for (const window of [limits.primary, limits.secondary]) {
    if (!Number.isFinite(window?.usedPercent) || window.usedPercent < 0
      || !Number.isFinite(window?.windowDurationMins) || window.windowDurationMins <= 0) continue;
    const reset = typeof window.resetsAt === 'number' && window.resetsAt > 0
      ? new Date(window.resetsAt * 1000) : null;
    windows.push({
      utilization: window.usedPercent,
      windowMinutes: window.windowDurationMins,
      resetsAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null,
    });
  }
  return {
    windows,
    planType: typeof limits.planType === 'string' ? limits.planType : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** Official read-only RPC. No prompt, thread, credential export or model call. */
export async function readCodexLimits(options: CodexReadRpcOptions = {}): Promise<CodexUsageSnapshot | null> {
  return parseCodexLimits(await readCodexRpc('account/rateLimits/read', {}, options));
}

export function createCodexUsageReader(read = readCodexLimits, now = Date.now) {
  let cached: { at: number; value: CodexUsageSnapshot | null } | null = null;
  let pending: Promise<CodexUsageSnapshot | null> | null = null;
  return async (): Promise<CodexUsageSnapshot | null> => {
    if (cached && now() - cached.at < 60_000) return cached.value;
    if (pending) return pending;
    pending = read().catch(() => null).then((value) => {
      cached = { at: now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const getCodexUsage = createCodexUsageReader();
