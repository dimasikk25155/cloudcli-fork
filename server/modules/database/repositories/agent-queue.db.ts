/**
 * «Конвейер»: queues of items an agent works through (agent_queues) and the
 * items themselves (agent_queue_items). Validation, ownership, the tick and
 * the verdict logic live in server/modules/agent-queue.
 */

import { getConnection } from '@/modules/database/connection.js';

export type AgentQueueStatus = 'running' | 'paused' | 'stopped' | 'done';
export type AgentQueueItemStatus = 'pending' | 'running' | 'ok' | 'rejected';

export type AgentQueueRow = {
  id: string;
  userId: number;
  agentId: string;
  title: string;
  template: string;
  parallel: number;
  maxAttempts: number;
  status: AgentQueueStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  notifiedAt: string | null;
};

export type AgentQueueItemRow = {
  id: number;
  queueId: string;
  position: number;
  input: string;
  status: AgentQueueItemStatus;
  attempts: number;
  pass: number;
  verdict: 'ok' | 'fail' | null;
  reason: string | null;
  excerpt: string | null;
  sessionId: string | null;
  manual: boolean;
  updatedAt: string;
};

export type AgentQueueCounts = { pending: number; running: number; ok: number; rejected: number; total: number };

export type AgentQueueInsert = {
  id: string;
  userId: number;
  agentId: string;
  title: string;
  template: string;
  parallel: number;
  maxAttempts: number;
  items: string[];
};

/** Outcome of one attempt. */
export type AgentQueueItemResult = {
  status: 'pending' | 'ok' | 'rejected';
  verdict: 'ok' | 'fail';
  reason: string;
  excerpt: string | null;
  sessionId: string | null;
};

type StoredQueue = {
  id: string;
  user_id: number;
  agent_id: string;
  title: string;
  template: string;
  parallel: number;
  max_attempts: number;
  status: AgentQueueStatus;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  notified_at: string | null;
};

type StoredItem = {
  id: number;
  queue_id: string;
  position: number;
  input: string;
  status: AgentQueueItemStatus;
  attempts: number;
  pass: number;
  verdict: 'ok' | 'fail' | null;
  reason: string | null;
  excerpt: string | null;
  session_id: string | null;
  manual: number;
  updated_at: string;
};

function toQueue(row: StoredQueue): AgentQueueRow {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    title: row.title,
    template: row.template,
    parallel: row.parallel,
    maxAttempts: row.max_attempts,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    notifiedAt: row.notified_at,
  };
}

function toItem(row: StoredItem): AgentQueueItemRow {
  return {
    id: row.id,
    queueId: row.queue_id,
    position: row.position,
    input: row.input,
    status: row.status,
    attempts: row.attempts,
    pass: row.pass,
    verdict: row.verdict,
    reason: row.reason,
    excerpt: row.excerpt,
    sessionId: row.session_id,
    manual: row.manual === 1,
    updatedAt: row.updated_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

export const agentQueueDb = {
  create(input: AgentQueueInsert): AgentQueueRow {
    const db = getConnection();
    const stamp = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO agent_queues (id, user_id, agent_id, title, template, parallel, max_attempts, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      ).run(input.id, input.userId, input.agentId, input.title, input.template, input.parallel, input.maxAttempts, stamp, stamp);
      const insertItem = db.prepare(
        `INSERT INTO agent_queue_items (queue_id, position, input, status, attempts, pass, updated_at)
         VALUES (?, ?, ?, 'pending', 0, 1, ?)`,
      );
      input.items.forEach((item, index) => insertItem.run(input.id, index + 1, item, stamp));
    })();
    return agentQueueDb.get(input.id)!;
  },

  get(id: string): AgentQueueRow | null {
    const row = getConnection().prepare('SELECT * FROM agent_queues WHERE id = ?').get(id) as StoredQueue | undefined;
    return row ? toQueue(row) : null;
  },

  /** Newest first. */
  listByUser(userId: number): AgentQueueRow[] {
    return (getConnection()
      .prepare('SELECT * FROM agent_queues WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(userId) as StoredQueue[]).map(toQueue);
  },

  /** Oldest first: the queue started earlier gets the free slots first. */
  listByStatus(status: AgentQueueStatus): AgentQueueRow[] {
    return (getConnection()
      .prepare('SELECT * FROM agent_queues WHERE status = ? ORDER BY created_at ASC, rowid ASC')
      .all(status) as StoredQueue[]).map(toQueue);
  },

  setStatus(id: string, status: AgentQueueStatus): void {
    const stamp = now();
    getConnection()
      .prepare(
        `UPDATE agent_queues
         SET status = ?, updated_at = ?,
             finished_at = CASE WHEN ? = 'done' THEN ? ELSE NULL END,
             notified_at = CASE WHEN ? = 'done' THEN notified_at ELSE NULL END
         WHERE id = ?`,
      )
      .run(status, stamp, status, stamp, status, id);
  },

  /** Records the «итог» notice; false when it was already recorded. */
  markNotified(id: string): boolean {
    return getConnection()
      .prepare('UPDATE agent_queues SET notified_at = ? WHERE id = ? AND notified_at IS NULL')
      .run(now(), id).changes > 0;
  },

  delete(id: string): boolean {
    return getConnection().prepare('DELETE FROM agent_queues WHERE id = ?').run(id).changes > 0;
  },

  items(queueId: string): AgentQueueItemRow[] {
    return (getConnection()
      .prepare('SELECT * FROM agent_queue_items WHERE queue_id = ? ORDER BY position ASC')
      .all(queueId) as StoredItem[]).map(toItem);
  },

  item(itemId: number): AgentQueueItemRow | null {
    const row = getConnection().prepare('SELECT * FROM agent_queue_items WHERE id = ?').get(itemId) as StoredItem | undefined;
    return row ? toItem(row) : null;
  },

  counts(queueId: string): AgentQueueCounts {
    const rows = getConnection()
      .prepare('SELECT status, COUNT(*) AS n FROM agent_queue_items WHERE queue_id = ? GROUP BY status')
      .all(queueId) as Array<{ status: AgentQueueItemStatus; n: number }>;
    const counts: AgentQueueCounts = { pending: 0, running: 0, ok: 0, rejected: 0, total: 0 };
    for (const row of rows) {
      counts[row.status] = row.n;
      counts.total += row.n;
    }
    return counts;
  },

  /** Takes the next pending item into work (attempt counted now) or null. */
  claimNext(queueId: string): AgentQueueItemRow | null {
    const db = getConnection();
    return db.transaction(() => {
      const next = db
        .prepare(`SELECT id FROM agent_queue_items WHERE queue_id = ? AND status = 'pending' ORDER BY position ASC LIMIT 1`)
        .get(queueId) as { id: number } | undefined;
      if (!next) return null;
      db.prepare(
        `UPDATE agent_queue_items SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      ).run(now(), next.id);
      return agentQueueDb.item(next.id);
    })();
  },

  /** Result of an attempt; only an item still in work takes it. */
  finishAttempt(itemId: number, result: AgentQueueItemResult): boolean {
    return getConnection()
      .prepare(
        `UPDATE agent_queue_items
         SET status = ?, verdict = ?, reason = ?, excerpt = ?, session_id = COALESCE(?, session_id), updated_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(result.status, result.verdict, result.reason, result.excerpt, result.sessionId, now(), itemId).changes > 0;
  },

  /**
   * After a restart: items left «в работе» go back to the queue — the attempt
   * stays counted. An item that used its last attempt goes to «брак».
   */
  recoverRunning(reason: string): number {
    const db = getConnection();
    const stamp = now();
    return db.transaction(() => {
      const rejected = db.prepare(
        `UPDATE agent_queue_items
         SET status = 'rejected', verdict = 'fail', reason = ?, updated_at = ?
         WHERE status = 'running' AND attempts >= (SELECT max_attempts FROM agent_queues q WHERE q.id = queue_id)`,
      ).run(reason, stamp).changes;
      const back = db.prepare(
        `UPDATE agent_queue_items SET status = 'pending', updated_at = ? WHERE status = 'running'`,
      ).run(stamp).changes;
      return rejected + back;
    })();
  },

  /** «Ещё проход»: брак → в очередь с новым счётчиком попыток. */
  retryRejected(queueId: string): number {
    return getConnection()
      .prepare(
        `UPDATE agent_queue_items
         SET status = 'pending', attempts = 0, pass = pass + 1, updated_at = ?
         WHERE queue_id = ? AND status = 'rejected'`,
      )
      .run(now(), queueId).changes;
  },

  /** Every pending item → «брак» with one reason (the agent is gone). */
  rejectPending(queueId: string, reason: string): number {
    return getConnection()
      .prepare(
        `UPDATE agent_queue_items SET status = 'rejected', verdict = 'fail', reason = ?, updated_at = ?
         WHERE queue_id = ? AND status = 'pending'`,
      )
      .run(reason, now(), queueId).changes;
  },

  /** Hand-checked OK of a finished item. */
  markOk(itemId: number): boolean {
    return getConnection()
      .prepare(
        `UPDATE agent_queue_items SET status = 'ok', manual = 1, updated_at = ?
         WHERE id = ? AND status IN ('rejected', 'pending')`,
      )
      .run(now(), itemId).changes > 0;
  },
};
