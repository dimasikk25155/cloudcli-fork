import { authenticatedFetch } from './api';

/**
 * Client-side snapshot of the subscription usage limits served by
 * GET /api/usage/limits (5-hour / 7-day windows + the run-guard threshold).
 *
 * Kept in a tiny module store so both the composer badge (which polls) and
 * handleSubmit (which needs a synchronous read before sending) share one
 * source without prop drilling.
 */
export type UsageLimitsSnapshot = {
  fiveHourPct: number | null;
  fiveHourResetsAt: string | null;
  sevenDayPct: number | null;
  sevenDayResetsAt: string | null;
  threshold: number;
  blocked: boolean;
  fetchedAt: number;
};

let latest: UsageLimitsSnapshot | null = null;
const listeners = new Set<() => void>();

export function getUsageLimits(): UsageLimitsSnapshot | null {
  return latest;
}

export function subscribeUsageLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshUsageLimits(): Promise<UsageLimitsSnapshot | null> {
  try {
    const response = await authenticatedFetch('/api/usage/limits');
    if (!response.ok) {
      return latest;
    }
    const data = await response.json();
    const fiveHour = data?.usage?.fiveHour ?? null;
    const sevenDay = data?.usage?.sevenDay ?? null;
    latest = {
      fiveHourPct: typeof fiveHour?.utilization === 'number' ? fiveHour.utilization : null,
      fiveHourResetsAt: typeof fiveHour?.resetsAt === 'string' ? fiveHour.resetsAt : null,
      sevenDayPct: typeof sevenDay?.utilization === 'number' ? sevenDay.utilization : null,
      sevenDayResetsAt: typeof sevenDay?.resetsAt === 'string' ? sevenDay.resetsAt : null,
      threshold: typeof data?.guard?.threshold === 'number' ? data.guard.threshold : 90,
      blocked: data?.guard?.blocked === true,
      fetchedAt: Date.now(),
    };
    listeners.forEach((listener) => listener());
  } catch (error) {
    console.warn('Failed to refresh usage limits:', error);
  }
  return latest;
}

/** Moscow wall-clock label for a reset timestamp, e.g. "18:29 МСК". */
export function formatResetMoscow(resetsAt: string | null, withDay = false): string {
  if (!resetsAt) {
    return '—';
  }
  try {
    return `${new Date(resetsAt).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      ...(withDay ? { weekday: 'short', day: 'numeric', month: 'numeric' } : {}),
    })} МСК`;
  } catch {
    return '—';
  }
}
