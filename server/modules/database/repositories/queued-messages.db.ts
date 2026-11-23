/**
 * «Очередь сообщений»: the one message a chat holds while its agent is busy.
 * One row per chat (a second put replaces the first). The decisions — send,
 * hold, who may touch it — live in the queued-messages module; this file only
 * stores the cell.
 */

import { getConnection } from '@/modules/database/connection.js';

export type QueuedMessageRow = {
  sessionId: string;
  /** Who queued it: the message is sent on their behalf. */
  userId: number | null;
  content: string;
  /** Send options of the composer (model, effort, mode…) as JSON, or null. */
  optionsJson: string | null;
  /** Already uploaded image descriptors as JSON, or null. */
  imagesJson: string | null;
  /** Why it does not go out by itself; null = goes when the turn ends. */
  holdReason: string | null;
  /** Text for a person, set with a failed send. */
  lastError: string | null;
  /** The user asked to interrupt the turn and send this message. */
  sendNow: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QueuedMessageInsert = {
  sessionId: string;
  userId: number | null;
  content: string;
  optionsJson: string | null;
  imagesJson: string | null;
  /** ISO time of the put. */
  at: string;
};

type StoredRow = {
  session_id: string;
  user_id: number | null;
  content: string;
  options_json: string | null;
  images_json: string | null;
  hold_reason: string | null;
  last_error: string | null;
  send_now: number;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'session_id, user_id, content, options_json, images_json, hold_reason, last_error, send_now, created_at, updated_at';

function toRow(row: StoredRow): QueuedMessageRow {
  return {
    sessionId: row.session_id,
    userId: row.user_id ?? null,
    content: row.content,
    optionsJson: row.options_json ?? null,
    imagesJson: row.images_json ?? null,
    holdReason: row.hold_reason ?? null,
    lastError: row.last_error ?? null,
    sendNow: row.send_now === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const queuedMessagesDb = {
  get(sessionId: string): QueuedMessageRow | null {
    const row = getConnection()
      .prepare(`SELECT ${COLUMNS} FROM session_queued_messages WHERE session_id = ?`)
      .get(sessionId) as StoredRow | undefined;
    return row ? toRow(row) : null;
  },

  list(): QueuedMessageRow[] {
    const rows = getConnection()
      .prepare(`SELECT ${COLUMNS} FROM session_queued_messages ORDER BY created_at, session_id`)
      .all() as StoredRow[];
    return rows.map(toRow);
  },

  /**
   * Queues a message, or replaces the chat's queued one: the new text is a
   * fresh message (no hold, no error, no «send now»), only the time it was
   * first queued is kept.
   */
  put(input: QueuedMessageInsert): QueuedMessageRow {
    getConnection()
      .prepare(
        `INSERT INTO session_queued_messages
           (session_id, user_id, content, options_json, images_json, hold_reason, last_error, send_now, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           user_id = excluded.user_id,
           content = excluded.content,
           options_json = excluded.options_json,
           images_json = excluded.images_json,
           hold_reason = NULL,
           last_error = NULL,
           send_now = 0,
           updated_at = excluded.updated_at`,
      )
      .run(input.sessionId, input.userId, input.content, input.optionsJson, input.imagesJson, input.at, input.at);
    return this.get(input.sessionId) as QueuedMessageRow;
  },

  /** Sets (or, with `holdReason: null`, lifts) the hold. False when the chat has nothing queued. */
  setHold(sessionId: string, input: { holdReason: string | null; lastError: string | null; at: string }): boolean {
    const result = getConnection()
      .prepare('UPDATE session_queued_messages SET hold_reason = ?, last_error = ?, updated_at = ? WHERE session_id = ?')
      .run(input.holdReason, input.lastError, input.at, sessionId);
    return result.changes > 0;
  },

  /** The «send now» mark does not touch `updated_at`: the message itself did not change. */
  setSendNow(sessionId: string, sendNow: boolean): boolean {
    const result = getConnection()
      .prepare('UPDATE session_queued_messages SET send_now = ? WHERE session_id = ?')
      .run(sendNow ? 1 : 0, sessionId);
    return result.changes > 0;
  },

  /**
   * Empties the chat's cell. With `updatedAt` only that exact version is
   * removed — a message edited while its previous text was being sent stays.
   */
  remove(sessionId: string, updatedAt?: string): boolean {
    const db = getConnection();
    const result = updatedAt === undefined
      ? db.prepare('DELETE FROM session_queued_messages WHERE session_id = ?').run(sessionId)
      : db.prepare('DELETE FROM session_queued_messages WHERE session_id = ? AND updated_at = ?').run(sessionId, updatedAt);
    return result.changes > 0;
  },

  /** Every queued message gets the same hold (server restart). Returns how many. */
  holdAll(holdReason: string, at: string): number {
    const result = getConnection()
      .prepare('UPDATE session_queued_messages SET hold_reason = ?, last_error = NULL, send_now = 0, updated_at = ?')
      .run(holdReason, at);
    return result.changes;
  },
};

export type QueuedMessagesDb = typeof queuedMessagesDb;
