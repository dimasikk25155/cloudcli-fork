/**
 * Answer tokens repository (pending-answers).
 *
 * Rows only: issuing, one-time spending and expiry rules live in the
 * pending-answers module.
 */
import { getConnection } from '../../../modules/database/connection.js';
export const answerTokensDb = {
    insertMany(rows) {
        if (rows.length === 0) {
            return;
        }
        const db = getConnection();
        const insert = db.prepare(`
      INSERT INTO answer_tokens
        (token, request_id, user_id, choice_id, label, decision_json, created_at, expires_at, used_at)
      VALUES (@token, @request_id, @user_id, @choice_id, @label, @decision_json, @created_at, @expires_at, @used_at)
    `);
        const run = db.transaction((batch) => {
            for (const row of batch) {
                insert.run(row);
            }
        });
        run(rows);
    },
    get(token) {
        const db = getConnection();
        const row = db
            .prepare('SELECT * FROM answer_tokens WHERE token = ?')
            .get(token);
        return row ?? null;
    },
    /**
     * Spends every still-unused token of a request in one statement.
     * Returns how many were spent: 0 means someone answered first.
     */
    spendRequest(requestId, usedAt) {
        const db = getConnection();
        return db
            .prepare('UPDATE answer_tokens SET used_at = ? WHERE request_id = ? AND used_at IS NULL')
            .run(usedAt, requestId).changes;
    },
    deleteExpired(beforeIso) {
        const db = getConnection();
        return db.prepare('DELETE FROM answer_tokens WHERE expires_at < ?').run(beforeIso).changes;
    },
};
//# sourceMappingURL=answer-tokens.db.js.map