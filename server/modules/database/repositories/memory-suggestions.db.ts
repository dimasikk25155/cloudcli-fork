/**
 * Vault-note suggestions repository (memory-suggestions).
 *
 * One row per app session. The review logic (when a session is quiet, what
 * the model is asked, retries) lives in the memory-suggestions module; this
 * file only reads and writes rows.
 */

import { getConnection } from '@/modules/database/connection.js';

export type MemorySuggestionStatus =
  | 'ineligible'
  | 'pending'
  | 'ready'
  | 'writing'
  | 'skipped'
  | 'failed'
  | 'written'
  | 'dismissed';

export type MemorySuggestionRow = {
  id: number;
  session_id: string;
  user_id: number | null;
  status: MemorySuggestionStatus;
  attempts: number;
  source_updated_at: string;
  title: string | null;
  folder: string | null;
  body: string | null;
  written_path: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** Ready row joined with its session for display. */
export type MemorySuggestionListRow = MemorySuggestionRow & {
  session_name: string | null;
  project_path: string | null;
};

export type MemorySuggestionWrite = Omit<MemorySuggestionRow, 'id' | 'created_at' | 'updated_at'> & { now: string };

export const memorySuggestionsDb = {
  getById(id: number): MemorySuggestionRow | null {
    const row = getConnection()
      .prepare('SELECT * FROM memory_suggestions WHERE id = ?')
      .get(id) as MemorySuggestionRow | undefined;
    return row ?? null;
  },

  getBySession(sessionId: string): MemorySuggestionRow | null {
    const row = getConnection()
      .prepare('SELECT * FROM memory_suggestions WHERE session_id = ?')
      .get(sessionId) as MemorySuggestionRow | undefined;
    return row ?? null;
  },

  /** Insert or replace the review state of one session; returns the row id. */
  save(row: MemorySuggestionWrite): number {
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
    return (db.prepare('SELECT id FROM memory_suggestions WHERE session_id = ?').get(row.session_id) as { id: number }).id;
  },

  /** Moves one row from `from` to `to` atomically; false when it was not in `from`. */
  transition(
    id: number,
    from: MemorySuggestionStatus,
    to: MemorySuggestionStatus,
    now: string,
    writtenPath: string | null = null,
  ): boolean {
    const result = getConnection().prepare(`
      UPDATE memory_suggestions
      SET status = ?, written_path = COALESCE(?, written_path), updated_at = ?
      WHERE id = ? AND status = ?
    `).run(to, writtenPath, now, id, from);
    return result.changes > 0;
  },

  /** A write cut short by a restart goes back to ready (the file was never confirmed). */
  resetInterruptedWrites(now: string): number {
    return getConnection()
      .prepare("UPDATE memory_suggestions SET status = 'ready', updated_at = ? WHERE status = 'writing'")
      .run(now).changes;
  },

  /** Ready suggestions of live (not archived) sessions, newest first. */
  listReady(sessionId?: string): MemorySuggestionListRow[] {
    const db = getConnection();
    const filter = sessionId ? 'AND m.session_id = ?' : '';
    const statement = db.prepare(`
      SELECT m.*, s.custom_name AS session_name, s.project_path AS project_path
      FROM memory_suggestions m
      JOIN sessions s ON s.session_id = m.session_id
      WHERE m.status = 'ready' AND COALESCE(s.isArchived, 0) = 0 ${filter}
      ORDER BY m.updated_at DESC
    `);
    return (sessionId ? statement.all(sessionId) : statement.all()) as MemorySuggestionListRow[];
  },
};
