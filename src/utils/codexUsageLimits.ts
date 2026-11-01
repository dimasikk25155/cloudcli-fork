import { authenticatedFetch } from './api';

export type CodexLimitWindow = { utilization: number; windowMinutes: number; resetsAt: string | null };
export type CodexLimits = { windows: CodexLimitWindow[]; planType: string | null; fetchedAt: string };

let latest: CodexLimits | null = null;
let pending: Promise<CodexLimits | null> | null = null;
const listeners = new Set<() => void>();
export const getCodexLimits = () => latest;
export function subscribeCodexLimits(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function refreshCodexLimits(): Promise<CodexLimits | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await authenticatedFetch('/api/usage/limits?provider=codex');
      const data = response.ok ? await response.json() : null;
      latest = data?.codex ?? null;
    } catch {
      latest = null;
    }
    listeners.forEach((listener) => listener());
    return latest;
  })().finally(() => { pending = null; });
  return pending;
}

export function codexWindowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}д`;
  if (minutes % 60 === 0) return `${minutes / 60}ч`;
  return `${minutes}мин`;
}
