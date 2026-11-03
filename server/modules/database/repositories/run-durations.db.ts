import { createHash } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export function answerHash(content: string): string {
  return createHash('sha256').update(content.trim().replace(/\s+/g, ' ')).digest('hex');
}

export type RunDurationRow = {
  run_id: string;
  session_id: string;
  started_at: number;
  finished_at: number;
  duration_ms: number;
  answer_hash: string;
};

export const runDurationsDb = {
  save(row: RunDurationRow): void {
    getConnection().prepare(`INSERT OR IGNORE INTO run_durations
      (run_id, session_id, started_at, finished_at, duration_ms, answer_hash)
      VALUES (?, ?, ?, ?, ?, ?)`).run(row.run_id, row.session_id, row.started_at,
      row.finished_at, row.duration_ms, row.answer_hash);
  },
  list(sessionId: string): RunDurationRow[] {
    return getConnection().prepare('SELECT * FROM run_durations WHERE session_id = ? ORDER BY finished_at')
      .all(sessionId) as RunDurationRow[];
  },
};
