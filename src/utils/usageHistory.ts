import { authenticatedFetch } from './api';

/**
 * Per-session token history served by GET /api/usage/history: days (newest
 * first) → sessions (heaviest first) with the full-throughput token burn per
 * session. Powers the expandable view of the "Token Usage" modal.
 */
export type UsageHistorySession = {
  project: string;
  projectPath: string | null;
  sessionId: string;
  title: string | null;
  tokens: number;
  output: number;
  model: string | null;
  lastActivity: string;
};

export type UsageHistoryDay = {
  day: string;
  tokens: number;
  sessions: UsageHistorySession[];
};

export async function fetchUsageHistory(): Promise<UsageHistoryDay[]> {
  const response = await authenticatedFetch('/api/usage/history');
  if (!response.ok) {
    throw new Error(`Usage history request failed (${response.status})`);
  }
  const data = await response.json();
  return Array.isArray(data?.days) ? (data.days as UsageHistoryDay[]) : [];
}

/** Compact token count, e.g. 471990 → "472K", 2400000 → "2.4M". */
export function formatTokensShort(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/**
 * Human day label in Moscow terms: "Сегодня" / "Вчера" for the two most recent
 * days, otherwise a short Russian date. `day` is a YYYY-MM-DD Moscow date.
 */
export function formatDayLabel(day: string): string {
  const todayMsk = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  if (day === todayMsk) {
    return 'Сегодня';
  }

  // Yesterday in Moscow: subtract a day from the Moscow calendar date.
  const [y, m, d] = day.split('-').map(Number);
  const asUtc = Date.UTC(y, (m || 1) - 1, d || 1);
  const yesterdayMsk = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }),
  );
  yesterdayMsk.setDate(yesterdayMsk.getDate() - 1);
  const yesterdayStr = `${yesterdayMsk.getFullYear()}-${String(yesterdayMsk.getMonth() + 1).padStart(2, '0')}-${String(yesterdayMsk.getDate()).padStart(2, '0')}`;
  if (day === yesterdayStr) {
    return 'Вчера';
  }

  try {
    return new Date(asUtc).toLocaleDateString('ru-RU', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      weekday: 'short',
    });
  } catch {
    return day;
  }
}
