/**
 * Agent threads repository (threads module): run tokens and the thread list.
 *
 * Rows only: issuing, expiry, limits and the automatic «Треды готовы» message
 * live in `server/modules/threads/`.
 */
import { getConnection } from '../../../modules/database/connection.js';
export const threadTokensDb = {
    insert(row) {
        getConnection()
            .prepare(`
        INSERT INTO thread_tokens (token_hash, session_id, user_id, permission_mode, issued_at, expires_at)
        VALUES (@token_hash, @session_id, @user_id, @permission_mode, @issued_at, @expires_at)
      `)
            .run(row);
    },
    get(tokenHash) {
        const row = getConnection()
            .prepare('SELECT * FROM thread_tokens WHERE token_hash = ?')
            .get(tokenHash);
        return row ?? null;
    },
    /** Sets the expiry of a token whose run just ended (only once). */
    setExpiry(tokenHash, expiresAt) {
        getConnection()
            .prepare('UPDATE thread_tokens SET expires_at = ? WHERE token_hash = ? AND expires_at IS NULL')
            .run(expiresAt, tokenHash);
    },
    /** Tokens of runs that never reported their end (server restart) get an expiry. */
    expireOpen(expiresAt) {
        return getConnection()
            .prepare('UPDATE thread_tokens SET expires_at = ? WHERE expires_at IS NULL')
            .run(expiresAt).changes;
    },
    deleteExpired(beforeIso) {
        return getConnection()
            .prepare('DELETE FROM thread_tokens WHERE expires_at IS NOT NULL AND expires_at < ?')
            .run(beforeIso).changes;
    },
};
export const sessionThreadsDb = {
    insert(row) {
        getConnection()
            .prepare(`
        INSERT INTO session_threads
          (thread_session_id, parent_session_id, user_id, provider, model, permission_mode,
           created_at, started_at, seen_at, notified_at)
        VALUES (@thread_session_id, @parent_session_id, @user_id, @provider, @model, @permission_mode,
                @created_at, @started_at, @seen_at, @notified_at)
      `)
            .run(row);
    },
    get(threadSessionId) {
        const row = getConnection()
            .prepare('SELECT * FROM session_threads WHERE thread_session_id = ?')
            .get(threadSessionId);
        return row ?? null;
    },
    /** Threads of one parent, oldest first. */
    listByParent(parentSessionId) {
        return getConnection()
            .prepare('SELECT * FROM session_threads WHERE parent_session_id = ? ORDER BY created_at, rowid')
            .all(parentSessionId);
    },
    /** A new run of the thread: its result is unread again. */
    markStarted(threadSessionId, startedAt) {
        getConnection()
            .prepare('UPDATE session_threads SET started_at = ?, seen_at = NULL, notified_at = NULL WHERE thread_session_id = ?')
            .run(startedAt, threadSessionId);
    },
    markSeen(threadSessionIds, seenAt) {
        if (threadSessionIds.length === 0)
            return;
        const db = getConnection();
        const update = db.prepare('UPDATE session_threads SET seen_at = ? WHERE thread_session_id = ? AND seen_at IS NULL');
        db.transaction((ids) => {
            for (const id of ids)
                update.run(seenAt, id);
        })(threadSessionIds);
    },
    markNotified(threadSessionIds, notifiedAt) {
        if (threadSessionIds.length === 0)
            return;
        const db = getConnection();
        const update = db.prepare('UPDATE session_threads SET notified_at = ? WHERE thread_session_id = ?');
        db.transaction((ids) => {
            for (const id of ids)
                update.run(notifiedAt, id);
        })(threadSessionIds);
    },
    delete(threadSessionId) {
        getConnection().prepare('DELETE FROM session_threads WHERE thread_session_id = ?').run(threadSessionId);
    },
};
//# sourceMappingURL=threads.db.js.map