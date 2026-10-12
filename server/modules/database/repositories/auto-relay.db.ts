/**
 * Auto-relay repository: the per-chat switch and the progress of its one
 * automatic move. Rows only — the rule and the orchestration live in
 * `server/modules/auto-relay/`.
 */

import { getConnection } from '@/modules/database/connection.js';

export type AutoRelayState = 'collecting' | 'creating' | 'done' | 'failed';

export type SessionAutoRelayRow = {
  session_id: string;
  enabled: number;
  state: AutoRelayState | null;
  nonce: string | null;
  user_id: number | null;
  child_session_id: string | null;
  error: string | null;
  /** JSON RelayDismissal: a continuation's measures after its first turn. */
  baseline_json: string | null;
  updated_at: string;
};

export type AutoRelayPatch = Partial<Omit<SessionAutoRelayRow, 'session_id' | 'updated_at'>>;

const COLUMNS = ['enabled', 'state', 'nonce', 'user_id', 'child_session_id', 'error', 'baseline_json'] as const;

export const sessionAutoRelayDb = {
  get(sessionId: string): SessionAutoRelayRow | null {
    const row = getConnection()
      .prepare('SELECT * FROM session_auto_relay WHERE session_id = ?')
      .get(sessionId) as SessionAutoRelayRow | undefined;
    return row ?? null;
  },

  /** Inserts the row when missing, then applies only the given columns. */
  upsert(sessionId: string, patch: AutoRelayPatch, updatedAt: string): SessionAutoRelayRow {
    const db = getConnection();
    db.prepare(`
      INSERT INTO session_auto_relay (session_id, enabled, updated_at)
      VALUES (?, 0, ?)
      ON CONFLICT(session_id) DO NOTHING
    `).run(sessionId, updatedAt);
    const keys = COLUMNS.filter((key) => key in patch);
    const assignments = [...keys.map((key) => `${key} = @${key}`), 'updated_at = @updated_at'].join(', ');
    const values: Record<string, unknown> = { session_id: sessionId, updated_at: updatedAt };
    for (const key of keys) values[key] = patch[key] ?? null;
    db.prepare(`UPDATE session_auto_relay SET ${assignments} WHERE session_id = @session_id`).run(values);
    return sessionAutoRelayDb.get(sessionId) as SessionAutoRelayRow;
  },

  /**
   * Moves a row from one of `from` states to the patch — atomically, so two
   * listeners cannot both start the same step. False when the row was not
   * in one of those states.
   */
  transition(sessionId: string, from: Array<AutoRelayState | null>, patch: AutoRelayPatch, updatedAt: string): boolean {
    const db = getConnection();
    const states = from.filter((state): state is AutoRelayState => state !== null);
    const conditions: string[] = [];
    if (states.length > 0) conditions.push(`state IN (${states.map(() => '?').join(', ')})`);
    if (from.includes(null)) conditions.push('state IS NULL');
    if (conditions.length === 0) return false;
    const keys = COLUMNS.filter((key) => key in patch);
    const assignments = [...keys.map((key) => `${key} = ?`), 'updated_at = ?'].join(', ');
    const result = db
      .prepare(`UPDATE session_auto_relay SET ${assignments} WHERE session_id = ? AND (${conditions.join(' OR ')})`)
      .run(...keys.map((key) => patch[key] ?? null), updatedAt, sessionId, ...states);
    return result.changes > 0;
  },

  /** Rows left mid-move by a previous process. */
  listInProgress(): SessionAutoRelayRow[] {
    return getConnection()
      .prepare("SELECT * FROM session_auto_relay WHERE state IN ('collecting', 'creating')")
      .all() as SessionAutoRelayRow[];
  },

  delete(sessionId: string): void {
    getConnection().prepare('DELETE FROM session_auto_relay WHERE session_id = ?').run(sessionId);
  },
};
