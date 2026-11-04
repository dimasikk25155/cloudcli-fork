/**
 * «Safari вживую»: which Safari window each chat shows on the workbench canvas.
 * One row per chat; access and mod checks live in the safari-live module.
 */

import { getConnection } from '@/modules/database/connection.js';

export type SafariLiveBindingRow = {
  sessionId: string;
  windowId: number;
  title: string;
  boundBy: 'agent' | 'user';
  updatedAt: string;
};

type StoredRow = {
  session_id: string;
  window_id: number;
  title: string;
  bound_by: string;
  updated_at: string;
};

function toBinding(row: StoredRow): SafariLiveBindingRow {
  return {
    sessionId: row.session_id,
    windowId: Number(row.window_id),
    title: row.title,
    boundBy: row.bound_by === 'user' ? 'user' : 'agent',
    updatedAt: row.updated_at,
  };
}

export const safariLiveBindingsDb = {
  get(sessionId: string): SafariLiveBindingRow | null {
    const row = getConnection()
      .prepare('SELECT session_id, window_id, title, bound_by, updated_at FROM safari_live_bindings WHERE session_id = ?')
      .get(sessionId) as StoredRow | undefined;
    return row ? toBinding(row) : null;
  },

  set(
    sessionId: string,
    input: { windowId: number; title: string; boundBy: 'agent' | 'user' },
  ): SafariLiveBindingRow {
    const updatedAt = new Date().toISOString();
    getConnection()
      .prepare(
        `INSERT INTO safari_live_bindings (session_id, window_id, title, bound_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           window_id = excluded.window_id,
           title = excluded.title,
           bound_by = excluded.bound_by,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, Math.trunc(input.windowId), input.title ?? '', input.boundBy, updatedAt);
    return { sessionId, windowId: Math.trunc(input.windowId), title: input.title ?? '', boundBy: input.boundBy, updatedAt };
  },

  clear(sessionId: string): void {
    getConnection().prepare('DELETE FROM safari_live_bindings WHERE session_id = ?').run(sessionId);
  },
};
