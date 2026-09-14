/**
 * One definition of "which day is it" for the whole backend.
 *
 * Usage history, the audit feed and (later) the spend cap all bucket by Moscow
 * wall-clock days. Two independent implementations of that would disagree for
 * three hours every night: the feed would show a run under today while the cap
 * counted it against yesterday, and the numbers on screen would stop adding up.
 *
 * Deliberately not configurable. This installation is operated from Moscow, and
 * a timezone setting would only create a way for two callers to pick different
 * answers.
 */

const MOSCOW_TZ = 'Europe/Moscow';

/** 'YYYY-MM-DD' in Moscow wall-clock for an ISO timestamp. */
export function moscowDay(iso: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: MOSCOW_TZ });
  } catch {
    return 'unknown';
  }
}

/** Today's Moscow date. */
export function moscowToday(now: Date = new Date()): string {
  return moscowDay(now.toISOString());
}

/**
 * The last `count` Moscow days, newest first, including today.
 *
 * Used instead of a date range in SQL: an `IN (...)` over a handful of literal
 * days uses the `day_msk` index, whereas `date(ts, '+3 hours')` in a WHERE
 * clause forces a full scan.
 */
export function moscowDaysBack(count: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  const safeCount = Math.max(1, Math.trunc(count));

  for (let index = 0; index < safeCount; index += 1) {
    const at = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
    days.push(moscowDay(at.toISOString()));
  }

  // A DST-free zone in practice, but de-duplicating keeps the SQL honest if two
  // offsets ever collapse onto the same date.
  return [...new Set(days)];
}
