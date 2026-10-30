/**
 * Vault-note suggestions repository (memory-suggestions).
 *
 * One row per app session. The review logic (when a session is quiet, what
 * the model is asked, retries) lives in the memory-suggestions module; this
 * file only reads and writes rows.
 */
import { getConnection } from '../../../modules/database/connection.js';
export const memorySuggestionsDb = {
    getById(id) {
        const row = getConnection()
            .prepare('SELECT * FROM memory_suggestions WHERE id = ?')
            .get(id);
        return row ?? null;
    },
    getBySession(sessionId) {
        const row = getConnection()
            .prepare('SELECT * FROM memory_suggestions WHERE session_id = ?')
            .get(sessionId);
        return row ?? null;
    },
    /** Insert or replace the review state of one session; returns the row id. */
    save(row) {
        const db = getConnection();
        db.prepare(`
      INSERT INTO memory_suggestions
        (session_id, user_id, status, attempts, source_updated_at, title, folder, body,
         written_path, last_error, created_at, updated_at)
      VALUES (@session_id, @user_id, @status, @attempts, @source_updated_at, @title, @folder, @body,
              @written_path, @last_error, @now, @now)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        status = excluded.status,
        attempts = excluded.attempts,
        source_updated_at = excluded.source_updated_at,
        title = excluded.title,
        folder = excluded.folder,
        body = excluded.body,
        written_path = excluded.written_path,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(row);
        return db.prepare('SELECT id FROM memory_suggestions WHERE session_id = ?').get(row.session_id).id;
    },
    /** Moves one row from `from` to `to` atomically; false when it was not in `from`. */
    transition(id, from, to, now, writtenPath = null) {
        const result = getConnection().prepare(`
      UPDATE memory_suggestions
      SET status = ?, written_path = COALESCE(?, written_path), updated_at = ?
      WHERE id = ? AND status = ?
    `).run(to, writtenPath, now, id, from);
        return result.changes > 0;
    },
    /** A write cut short by a restart goes back to ready (the file was never confirmed). */
    resetInterruptedWrites(now) {
        return getConnection()
            .prepare("UPDATE memory_suggestions SET status = 'ready', updated_at = ? WHERE status = 'writing'")
            .run(now).changes;
    },
    /** Ready suggestions of live (not archived) sessions, newest first. */
    listReady(sessionId) {
        const db = getConnection();
        const filter = sessionId ? 'AND m.session_id = ?' : '';
        const statement = db.prepare(`
      SELECT m.*, s.custom_name AS session_name, s.project_path AS project_path
      FROM memory_suggestions m
      JOIN sessions s ON s.session_id = m.session_id
      WHERE m.status = 'ready' AND COALESCE(s.isArchived, 0) = 0 ${filter}
      ORDER BY m.updated_at DESC
    `);
        return (sessionId ? statement.all(sessionId) : statement.all());
    },
};
//# sourceMappingURL=memory-suggestions.db.js.map