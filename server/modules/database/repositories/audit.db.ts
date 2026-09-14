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

import { getConnection } from '@/modules/database/connection.js';

/** Who or what started the run. Deliberately distinct from `user_id`. */
export type AuditActor =
  | 'user'
  | 'schedule'
  | 'pipeline'
  | 'telegram'
  | 'api'
  | 'git-helper'
  | 'system';

/**
 * Closed vocabulary. Keeping this a union rather than free text is what lets
 * the feed filter and translate reliably — and stops a typo from creating an
 * event class nobody ever queries.
 */
export type AuditEvent =
  | 'run.start'
  | 'run.finish'
  | 'run.error'
  | 'perm.requested'
  | 'perm.approved'
  | 'perm.denied'
  | 'perm.expired';

export type AuditOutcome = 'ok' | 'error' | 'aborted' | 'denied' | 'expired';

export type AuditRow = {
  id: number;
  ts: string;
  day_msk: string;
  user_id: number | null;
  actor: AuditActor;
  project_id: string | null;
  project_path: string | null;
  session_id: string | null;
  run_id: string | null;
  event: AuditEvent;
  provider: string | null;
  model: string | null;
  tool_name: string | null;
  detail: string;
  outcome: AuditOutcome | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cost_micro_usd: number;
  duration_ms: number | null;
};

export type AppendAuditInput = {
  ts: string;
  dayMsk: string;
  userId?: number | null;
  actor: AuditActor;
  projectId?: string | null;
  projectPath?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  event: AuditEvent;
  provider?: string | null;
  model?: string | null;
  toolName?: string | null;
  detail?: string;
  outcome?: AuditOutcome | null;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  costMicroUsd?: number;
  durationMs?: number | null;
};

export type AuditFeedFilter = {
  /** 'YYYY-MM-DD' in Moscow time. */
  day?: string;
  projectId?: string;
  userId?: number;
  actor?: AuditActor;
  event?: AuditEvent;
  /** Keyset pagination: return rows with id strictly below this. */
  beforeId?: number;
  limit?: number;
};

export type SpendScope = {
  userId?: number;
  projectId?: string;
};

export type SpendTotals = {
  costMicroUsd: number;
  tokensIn: number;
  tokensOut: number;
  runs: number;
};

const SELECT_COLUMNS = `
  id, ts, day_msk, user_id, actor, project_id, project_path, session_id, run_id,
  event, provider, model, tool_name, detail, outcome,
  tokens_in, tokens_out, cache_read, cache_write_5m, cache_write_1h,
  cost_micro_usd, duration_ms
`;

const DEFAULT_FEED_LIMIT = 100;
const MAX_FEED_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit as number)) return DEFAULT_FEED_LIMIT;
  return Math.min(Math.max(Math.trunc(limit as number), 1), MAX_FEED_LIMIT);
}

export const auditDb = {
  /**
   * Writes one row. Returns the row, or null when the write was a duplicate.
   *
   * `run.finish` carries a unique index on `run_id`, so a retried or
   * reconnected run cannot bill twice — the second insert is ignored rather
   * than raising. Callers treat null as "already recorded", not as failure.
   */
  appendEvent(input: AppendAuditInput): AuditRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `INSERT INTO audit_log
           (ts, day_msk, user_id, actor, project_id, project_path, session_id, run_id,
            event, provider, model, tool_name, detail, outcome,
            tokens_in, tokens_out, cache_read, cache_write_5m, cache_write_1h,
            cost_micro_usd, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_COLUMNS}`
      )
      .get(
        input.ts,
        input.dayMsk,
        input.userId ?? null,
        input.actor,
        input.projectId ?? null,
        input.projectPath ?? null,
        input.sessionId ?? null,
        input.runId ?? null,
        input.event,
        input.provider ?? null,
        input.model ?? null,
        input.toolName ?? null,
        input.detail ?? '',
        input.outcome ?? null,
        input.tokensIn ?? 0,
        input.tokensOut ?? 0,
        input.cacheRead ?? 0,
        input.cacheWrite5m ?? 0,
        input.cacheWrite1h ?? 0,
        input.costMicroUsd ?? 0,
        input.durationMs ?? null
      ) as AuditRow | undefined;
    return row ?? null;
  },

  /** Newest first, keyset-paginated. */
  listEvents(filter: AuditFeedFilter = {}): AuditRow[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

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
      .all(...values, clampLimit(filter.limit)) as AuditRow[];
  },

  /** Every row belonging to one run, oldest first — the timeline view. */
  getRunTimeline(runId: string): AuditRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM audit_log WHERE run_id = ? ORDER BY id`)
      .all(runId) as AuditRow[];
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
  sumSpend(days: string[], scope: SpendScope = {}): SpendTotals {
    if (days.length === 0) {
      return { costMicroUsd: 0, tokensIn: 0, tokensOut: 0, runs: 0 };
    }

    const conditions: string[] = [
      `event = 'run.finish'`,
      `day_msk IN (${days.map(() => '?').join(', ')})`,
    ];
    const values: unknown[] = [...days];

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
      .prepare(
        `SELECT
           COALESCE(SUM(cost_micro_usd), 0) AS costMicroUsd,
           COALESCE(SUM(tokens_in), 0)      AS tokensIn,
           COALESCE(SUM(tokens_out), 0)     AS tokensOut,
           COUNT(*)                         AS runs
         FROM audit_log
         WHERE ${conditions.join(' AND ')}`
      )
      .get(...values) as SpendTotals;

    return row;
  },

  /** The runs that cost the most over the given days — "where did it go". */
  topRuns(days: string[], scope: SpendScope = {}, limit = 5): AuditRow[] {
    if (days.length === 0) return [];

    const conditions: string[] = [
      `event = 'run.finish'`,
      `day_msk IN (${days.map(() => '?').join(', ')})`,
    ];
    const values: unknown[] = [...days];

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
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM audit_log
         WHERE ${conditions.join(' AND ')}
         ORDER BY cost_micro_usd DESC, id DESC
         LIMIT ?`
      )
      .all(...values, clampLimit(limit)) as AuditRow[];
  },

  /** Spend broken down by project, biggest first. */
  spendByProject(days: string[], scope: SpendScope = {}): Array<{
    projectId: string | null;
    projectPath: string | null;
    costMicroUsd: number;
    tokensIn: number;
    tokensOut: number;
    runs: number;
  }> {
    if (days.length === 0) return [];

    const conditions: string[] = [
      `event = 'run.finish'`,
      `day_msk IN (${days.map(() => '?').join(', ')})`,
    ];
    const values: unknown[] = [...days];

    if (scope.userId !== undefined) {
      conditions.push('user_id = ?');
      values.push(scope.userId);
    }

    const db = getConnection();
    return db
      .prepare(
        `SELECT
           project_id   AS projectId,
           MAX(project_path) AS projectPath,
           COALESCE(SUM(cost_micro_usd), 0) AS costMicroUsd,
           COALESCE(SUM(tokens_in), 0) AS tokensIn,
           COALESCE(SUM(tokens_out), 0) AS tokensOut,
           COUNT(*) AS runs
         FROM audit_log
         WHERE ${conditions.join(' AND ')}
         GROUP BY project_id
         ORDER BY costMicroUsd DESC`
      )
      .all(...values) as Array<{
        projectId: string | null;
        projectPath: string | null;
        costMicroUsd: number;
        tokensIn: number;
        tokensOut: number;
        runs: number;
      }>;
  },
};
