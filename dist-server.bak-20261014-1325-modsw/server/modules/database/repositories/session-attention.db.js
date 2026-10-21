/**
 * Session attention repository ("Ждут тебя").
 *
 * Persists one status row per app session plus per-user seen marks. All the
 * state-machine logic lives in the session-attention module; this file only
 * reads and writes rows.
 */
import { getConnection } from '../../../modules/database/connection.js';
export const sessionAttentionDb = {
    get(sessionId) {
        const db = getConnection();
        const row = db
            .prepare('SELECT * FROM session_attention WHERE session_id = ?')
            .get(sessionId);
        return row ?? null;
    },
    upsert(row) {
        const db = getConnection();
        db.prepare(`
      INSERT INTO session_attention
        (session_id, user_id, project_id, provider, state, reason, detail_json, updated_at)
      VALUES (@session_id, @user_id, @project_id, @provider, @state, @reason, @detail_json, @updated_at)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        project_id = excluded.project_id,
        provider = excluded.provider,
        state = excluded.state,
        reason = excluded.reason,
        detail_json = excluded.detail_json,
        updated_at = excluded.updated_at
    `).run({
            session_id: row.session_id,
            user_id: row.user_id,
            project_id: row.project_id,
            provider: row.provider,
            state: row.state,
            reason: row.reason,
            detail_json: row.detail_json,
            updated_at: row.updated_at,
        });
    },
    /**
     * Moves the session's last model output time forward (never back). Kept out
     * of `upsert` so status transitions without a model reply — a new run, an
     * answer, the boot reconcile — do not touch it.
     */
    touchLastModelAt(sessionId, at) {
        const db = getConnection();
        db.prepare(`
      UPDATE session_attention SET last_model_at = ?
      WHERE session_id = ? AND (last_model_at IS NULL OR last_model_at < ?)
    `).run(at, sessionId, at);
    },
    listByStates(states) {
        if (states.length === 0) {
            return [];
        }
        const db = getConnection();
        const placeholders = states.map(() => '?').join(', ');
        return db
            .prepare(`SELECT * FROM session_attention WHERE state IN (${placeholders})`)
            .all(...states);
    },
    /**
     * Every status row whose session still exists and is not archived, joined
     * with project info and the given user's seen mark. The project id comes
     * from the live session→project mapping first (a moved/renamed project keeps
     * working), falling back to the id captured when the run started.
     */
    listWithSeen(userId) {
        const db = getConnection();
        return db.prepare(`
      SELECT a.*,
             COALESCE(p.project_id, a.project_id) AS resolved_project_id,
             COALESCE(p.project_path, s.project_path) AS project_path,
             p.custom_project_name AS custom_project_name,
             s.custom_name AS session_name,
             s.model AS session_model,
             seen.seen_at AS seen_at
      FROM session_attention a
      JOIN sessions s ON s.session_id = a.session_id
      LEFT JOIN projects p ON p.project_path = s.project_path
      LEFT JOIN session_attention_seen seen
        ON seen.session_id = a.session_id AND seen.user_id = ?
      WHERE COALESCE(s.isArchived, 0) = 0
      ORDER BY a.updated_at DESC
    `).all(userId ?? -1);
    },
    markSeen(userId, sessionIds, seenAt) {
        if (sessionIds.length === 0) {
            return;
        }
        const db = getConnection();
        const upsert = db.prepare(`
      INSERT INTO session_attention_seen (user_id, session_id, seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, session_id) DO UPDATE SET seen_at = excluded.seen_at
    `);
        const run = db.transaction((ids) => {
            for (const sessionId of ids) {
                upsert.run(userId, sessionId, seenAt);
            }
        });
        run(sessionIds);
    },
};
//# sourceMappingURL=session-attention.db.js.map