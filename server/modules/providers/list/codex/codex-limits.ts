import { spawn } from 'node:child_process';
import readline from 'node:readline';

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
export function readCodexLimits({ spawnImpl = spawn, timeoutMs = 12_000 } = {}): Promise<CodexUsageSnapshot | null> {
  return new Promise((resolve) => {
    const child = spawnImpl('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = readline.createInterface({ input: child.stdout! });
    let settled = false;
    const finish = (value: CodexUsageSnapshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin?.end();
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const send = (request: unknown) => child.stdin?.write(`${JSON.stringify(request)}\n`);
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));
    child.stdin?.on('error', () => finish(null));
    lines.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (response.id === 1) {
          if (response.error) return finish(null);
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else if (response.id === 2) {
          finish(response.error ? null : parseCodexLimits(response.result));
        }
      } catch { /* Ignore non-protocol stdout; never log account data. */ }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'neo3_usage', version: '1.0.0' } } });
  });
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
