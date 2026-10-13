const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * SQLite CURRENT_TIMESTAMP is UTC without a timezone suffix ("2026-10-12 17:30:31").
 * Every session reader turns it (or any parseable time) into a canonical ISO
 * string, so the client never reads a fresh row as local time. Unparseable or
 * empty input → null.
 */
export function sqliteTimestampToIso(value?: string | null): string | null {
  if (!value) return null;
  const candidate = SQLITE_UTC_TIMESTAMP_REGEX.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
