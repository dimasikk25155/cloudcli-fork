/**
 * Auto-relay repository: the per-chat switch and the progress of its one
 * automatic move. Rows only — the rule and the orchestration live in
 * `server/modules/auto-relay/`.
 */
import { getConnection } from '../../../modules/database/connection.js';
const COLUMNS = ['enabled', 'state', 'nonce', 'user_id', 'child_session_id', 'error', 'baseline_json', 'manual'];
export const sessionAutoRelayDb = {
    get(sessionId) {
        const row = getConnection()
            .prepare('SELECT * FROM session_auto_relay WHERE session_id = ?')
            .get(sessionId);
        return row ?? null;
    },
    /** Inserts the row when missing, then applies only the given columns. */
    upsert(sessionId, patch, updatedAt) {
        const db = getConnection();
        db.prepare(`
      INSERT INTO session_auto_relay (session_id, enabled, updated_at)
      VALUES (?, 0, ?)
      ON CONFLICT(session_id) DO NOTHING
    `).run(sessionId, updatedAt);
        const keys = COLUMNS.filter((key) => key in patch);
        const assignments = [...keys.map((key) => `${key} = @${key}`), 'updated_at = @updated_at'].join(', ');
        const values = { session_id: sessionId, updated_at: updatedAt };
        for (const key of keys)
            values[key] = patch[key] ?? null;
        db.prepare(`UPDATE session_auto_relay SET ${assignments} WHERE session_id = @session_id`).run(values);
        return sessionAutoRelayDb.get(sessionId);
    },
    /**
     * Moves a row from one of `from` states to the patch — atomically, so two
     * listeners cannot both start the same step. False when the row was not
     * in one of those states.
     */
    transition(sessionId, from, patch, updatedAt) {
        const db = getConnection();
        const states = from.filter((state) => state !== null);
        const conditions = [];
        if (states.length > 0)
            conditions.push(`state IN (${states.map(() => '?').join(', ')})`);
        if (from.includes(null))
            conditions.push('state IS NULL');
        if (conditions.length === 0)
            return false;
        const keys = COLUMNS.filter((key) => key in patch);
        const assignments = [...keys.map((key) => `${key} = ?`), 'updated_at = ?'].join(', ');
        const result = db
            .prepare(`UPDATE session_auto_relay SET ${assignments} WHERE session_id = ? AND (${conditions.join(' OR ')})`)
            .run(...keys.map((key) => patch[key] ?? null), updatedAt, sessionId, ...states);
        return result.changes > 0;
    },
    /** Rows left mid-move by a previous process. */
    listInProgress() {
        return getConnection()
            .prepare("SELECT * FROM session_auto_relay WHERE state IN ('collecting', 'creating')")
            .all();
    },
    delete(sessionId) {
        getConnection().prepare('DELETE FROM session_auto_relay WHERE session_id = ?').run(sessionId);
    },
};
//# sourceMappingURL=auto-relay.db.js.map