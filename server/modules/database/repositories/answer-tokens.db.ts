/**
 * Answer tokens repository (pending-answers).
 *
 * Rows only: issuing, one-time spending and expiry rules live in the
 * pending-answers module.
 */

import { getConnection } from '@/modules/database/connection.js';

export type AnswerTokenRow = {
  token: string;
  request_id: string;
  user_id: number;
  choice_id: string;
  label: string;
  decision_json: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export const answerTokensDb = {
  insertMany(rows: AnswerTokenRow[]): void {
    if (rows.length === 0) {
      return;
    }
    const db = getConnection();
    const insert = db.prepare(`
      INSERT INTO answer_tokens
        (token, request_id, user_id, choice_id, label, decision_json, created_at, expires_at, used_at)
      VALUES (@token, @request_id, @user_id, @choice_id, @label, @decision_json, @created_at, @expires_at, @used_at)
    `);
    const run = db.transaction((batch: AnswerTokenRow[]) => {
      for (const row of batch) {
        insert.run(row);
      }
    });
    run(rows);
  },

  get(token: string): AnswerTokenRow | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT * FROM answer_tokens WHERE token = ?')
      .get(token) as AnswerTokenRow | undefined;
    return row ?? null;
  },

  /**
   * Spends every still-unused token of a request in one statement.
   * Returns how many were spent: 0 means someone answered first.
   */
  spendRequest(requestId: string, usedAt: string): number {
    const db = getConnection();
    return db
      .prepare('UPDATE answer_tokens SET used_at = ? WHERE request_id = ? AND used_at IS NULL')
      .run(usedAt, requestId).changes;
  },

  deleteExpired(beforeIso: string): number {
    const db = getConnection();
    return db.prepare('DELETE FROM answer_tokens WHERE expires_at < ?').run(beforeIso).changes;
  },
};
