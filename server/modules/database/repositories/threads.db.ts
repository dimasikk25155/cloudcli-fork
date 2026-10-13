/**
 * Agent threads repository (threads module): run tokens and the thread list.
 *
 * Rows only: issuing, expiry, limits and the automatic «Треды готовы» message
 * live in `server/modules/threads/`.
 */

import { getConnection } from '@/modules/database/connection.js';

export type ThreadTokenRow = {
  token_hash: string;
  session_id: string;
  user_id: number;
  permission_mode: string | null;
  issued_at: string;
  expires_at: string | null;
};

export type SessionThreadRow = {
  thread_session_id: string;
  parent_session_id: string;
  user_id: number;
  provider: string;
  model: string | null;
  permission_mode: string | null;
  created_at: string;
  started_at: string;
  seen_at: string | null;
  notified_at: string | null;
};

export const threadTokensDb = {
  insert(row: ThreadTokenRow): void {
    getConnection()
      .prepare(`
        INSERT INTO thread_tokens (token_hash, session_id, user_id, permission_mode, issued_at, expires_at)
        VALUES (@token_hash, @session_id, @user_id, @permission_mode, @issued_at, @expires_at)
      `)
      .run(row);
  },

  get(tokenHash: string): ThreadTokenRow | null {
    const row = getConnection()
      .prepare('SELECT * FROM thread_tokens WHERE token_hash = ?')
      .get(tokenHash) as ThreadTokenRow | undefined;
    return row ?? null;
  },

  /** Sets the expiry of a token whose run just ended (only once). */
  setExpiry(tokenHash: string, expiresAt: string): void {
    getConnection()
      .prepare('UPDATE thread_tokens SET expires_at = ? WHERE token_hash = ? AND expires_at IS NULL')
      .run(expiresAt, tokenHash);
  },

  /** Tokens of runs that never reported their end (server restart) get an expiry. */
  expireOpen(expiresAt: string): number {
    return getConnection()
      .prepare('UPDATE thread_tokens SET expires_at = ? WHERE expires_at IS NULL')
      .run(expiresAt).changes;
  },

  deleteExpired(beforeIso: string): number {
    return getConnection()
      .prepare('DELETE FROM thread_tokens WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(beforeIso).changes;
  },
};

export const sessionThreadsDb = {
  insert(row: SessionThreadRow): void {
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

  get(threadSessionId: string): SessionThreadRow | null {
    const row = getConnection()
      .prepare('SELECT * FROM session_threads WHERE thread_session_id = ?')
      .get(threadSessionId) as SessionThreadRow | undefined;
    return row ?? null;
  },

  /** Threads of one parent, oldest first. */
  listByParent(parentSessionId: string): SessionThreadRow[] {
    return getConnection()
      .prepare('SELECT * FROM session_threads WHERE parent_session_id = ? ORDER BY created_at, rowid')
      .all(parentSessionId) as SessionThreadRow[];
  },

  /** A new run of the thread: its result is unread again. */
  markStarted(threadSessionId: string, startedAt: string): void {
    getConnection()
      .prepare('UPDATE session_threads SET started_at = ?, seen_at = NULL, notified_at = NULL WHERE thread_session_id = ?')
      .run(startedAt, threadSessionId);
  },

  markSeen(threadSessionIds: string[], seenAt: string): void {
    if (threadSessionIds.length === 0) return;
    const db = getConnection();
    const update = db.prepare('UPDATE session_threads SET seen_at = ? WHERE thread_session_id = ? AND seen_at IS NULL');
    db.transaction((ids: string[]) => {
      for (const id of ids) update.run(seenAt, id);
    })(threadSessionIds);
  },

  markNotified(threadSessionIds: string[], notifiedAt: string): void {
    if (threadSessionIds.length === 0) return;
    const db = getConnection();
    const update = db.prepare('UPDATE session_threads SET notified_at = ? WHERE thread_session_id = ?');
    db.transaction((ids: string[]) => {
      for (const id of ids) update.run(notifiedAt, id);
    })(threadSessionIds);
  },

  delete(threadSessionId: string): void {
    getConnection().prepare('DELETE FROM session_threads WHERE thread_session_id = ?').run(threadSessionId);
  },
};
