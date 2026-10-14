/**
 * Audit log repository.
 *
 * Append-only by design: the table refuses UPDATE and DELETE at the trigger
 * level, so this module deliberately exposes no way to edit or remove a row.
 * Everything here either writes one new row or reads.
 *
 * Money is stored as integer micro-USD (millionths of a dollar). Floats drift
 * when summed across thousands of rows, and this column is what a spend cap
 * will eventually be compared against.
 */
import { getConnection } from '../../../modules/database/connection.js';
const SELECT_COLUMNS = `
  id, ts, day_msk, user_id, actor, project_id, project_path, session_id, run_id,
  event, provider, model, tool_name, detail, outcome,
  tokens_in, tokens_out, cache_read, cache_write_5m, cache_write_1h,
  cost_micro_usd, duration_ms
`;
const DEFAULT_FEED_LIMIT = 100;
const MAX_FEED_LIMIT = 500;
function clampLimit(limit) {
    if (!Number.isFinite(limit))
        return DEFAULT_FEED_LIMIT;
    return Math.min(Math.max(Math.trunc(limit), 1), MAX_FEED_LIMIT);
}
export const auditDb = {
    /**
     * Writes one row. Returns the row, or null when the write was a duplicate.
     *
     * `run.finish` carries a unique index on `run_id`, so a retried or
     * reconnected run cannot bill twice — the second insert is ignored rather
     * than raising. Callers treat null as "already recorded", not as failure.
     */
    appendEvent(input) {
        const db = getConnection();
        const row = db
            .prepare(`INSERT INTO audit_log
           (ts, day_msk, user_id, actor, project_id, project_path, session_id, run_id,
            event, provider, model, tool_name, detail, outcome,
            tokens_in, tokens_out, cache_read, cache_write_5m, cache_write_1h,
            cost_micro_usd, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_COLUMNS}`)
            .get(input.ts, input.dayMsk, input.userId ?? null, input.actor, input.projectId ?? null, input.projectPath ?? null, input.sessionId ?? null, input.runId ?? null, input.event, input.provider ?? null, input.model ?? null, input.toolName ?? null, input.detail ?? '', input.outcome ?? null, input.tokensIn ?? 0, input.tokensOut ?? 0, input.cacheRead ?? 0, input.cacheWrite5m ?? 0, input.cacheWrite1h ?? 0, input.costMicroUsd ?? 0, input.durationMs ?? null);
        return row ?? null;
    },
    /** Newest first, keyset-paginated. */
    listEvents(filter = {}) {
        const conditions = [];
        const values = [];
        if (filter.day) {
            conditions.push('day_msk = ?');
            values.push(filter.day);
        }
        if (filter.projectId) {
            conditions.push('project_id = ?');
            values.push(filter.projectId);
        }
        if (filter.userId !== undefined) {
            conditions.push('user_id = ?');
            values.push(filter.userId);
        }
        if (filter.actor) {
            conditions.push('actor = ?');
            values.push(filter.actor);
        }
        if (filter.event) {
            conditions.push('event = ?');
            values.push(filter.event);
        }
        if (filter.beforeId !== undefined) {
            conditions.push('id < ?');
            values.push(filter.beforeId);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const db = getConnection();
        return db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
            .all(...values, clampLimit(filter.limit));
    },
    /** Every row belonging to one run, oldest first — the timeline view. */
    getRunTimeline(runId) {
        const db = getConnection();
        return db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM audit_log WHERE run_id = ? ORDER BY id`)
            .all(runId);
    },
    /**
     * Spend over a set of Moscow days.
     *
     * Only `run.finish` rows carry cost, so summing over every event would be
     * both wrong and slower. Days are passed in explicitly (rather than computing
     * a range here) so that callers use one shared notion of "today" and "this
     * week" — a second definition of the Moscow day is how a feed and a cap end
     * up disagreeing by three hours.
     */
    sumSpend(days, scope = {}) {
        if (days.length === 0) {
            return { costMicroUsd: 0, tokensIn: 0, tokensOut: 0, runs: 0 };
        }
        const conditions = [
            `event = 'run.finish'`,
            `day_msk IN (${days.map(() => '?').join(', ')})`,
        ];
        const values = [...days];
        if (scope.userId !== undefined) {
            conditions.push('user_id = ?');
            values.push(scope.userId);
        }
        if (scope.projectId) {
            conditions.push('project_id = ?');
            values.push(scope.projectId);
        }
        const db = getConnection();
        const row = db
            .prepare(`SELECT
           COALESCE(SUM(cost_micro_usd), 0) AS costMicroUsd,
           COALESCE(SUM(tokens_in), 0)      AS tokensIn,
           COALESCE(SUM(tokens_out), 0)     AS tokensOut,
           COUNT(*)                         AS runs
         FROM audit_log
         WHERE ${conditions.join(' AND ')}`)
            .get(...values);
        return row;
    },
    /** The runs that cost the most over the given days — "where did it go". */
    topRuns(days, scope = {}, limit = 5) {
        if (days.length === 0)
            return [];
        const conditions = [
            `event = 'run.finish'`,
            `day_msk IN (${days.map(() => '?').join(', ')})`,
        ];
        const values = [...days];
        if (scope.userId !== undefined) {
            conditions.push('user_id = ?');
            values.push(scope.userId);
        }
        if (scope.projectId) {
            conditions.push('project_id = ?');
            values.push(scope.projectId);
        }
        const db = getConnection();
        return db
            .prepare(`SELECT ${SELECT_COLUMNS} FROM audit_log
         WHERE ${conditions.join(' AND ')}
         ORDER BY cost_micro_usd DESC, id DESC
         LIMIT ?`)
            .all(...values, clampLimit(limit));
    },
    /** Spend broken down by project, biggest first. */
    spendByProject(days, scope = {}) {
        if (days.length === 0)
            return [];
        const conditions = [
            `event = 'run.finish'`,
            `day_msk IN (${days.map(() => '?').join(', ')})`,
        ];
        const values = [...days];
        if (scope.userId !== undefined) {
            conditions.push('user_id = ?');
            values.push(scope.userId);
        }
        const db = getConnection();
        return db
            .prepare(`SELECT
           project_id   AS projectId,
           MAX(project_path) AS projectPath,
           COALESCE(SUM(cost_micro_usd), 0) AS costMicroUsd,
           COALESCE(SUM(tokens_in), 0) AS tokensIn,
           COALESCE(SUM(tokens_out), 0) AS tokensOut,
           COUNT(*) AS runs
         FROM audit_log
         WHERE ${conditions.join(' AND ')}
         GROUP BY project_id
         ORDER BY costMicroUsd DESC`)
            .all(...values);
    },
};
//# sourceMappingURL=audit.db.js.map