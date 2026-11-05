/**
 * «Браузер вживую»: which page of the Neo3 browser each chat shows on the workbench
 * canvas, with the page's last address (reopened after the browser was unloaded).
 * One row per chat; access and mod checks live in the safari-live module.
 * Rows from the Safari version (no `page_id`) are ignored.
 */

import { getConnection } from '@/modules/database/connection.js';

export type SafariLiveBindingRow = {
  sessionId: string;
  pageId: string;
  url: string;
  title: string;
  boundBy: 'agent' | 'user';
  updatedAt: string;
};

type StoredRow = {
  session_id: string;
  page_id: string | null;
  url: string | null;
  title: string;
  bound_by: string;
  updated_at: string;
};

function toBinding(row: StoredRow): SafariLiveBindingRow {
  return {
    sessionId: row.session_id,
    pageId: String(row.page_id),
    url: row.url ?? '',
    title: row.title,
    boundBy: row.bound_by === 'user' ? 'user' : 'agent',
    updatedAt: row.updated_at,
  };
}

export const safariLiveBindingsDb = {
  get(sessionId: string): SafariLiveBindingRow | null {
    const row = getConnection()
      .prepare('SELECT session_id, page_id, url, title, bound_by, updated_at FROM safari_live_bindings WHERE session_id = ?')
      .get(sessionId) as StoredRow | undefined;
    return row && row.page_id ? toBinding(row) : null;
  },

  set(
    sessionId: string,
    input: { pageId: string; url: string; title: string; boundBy: 'agent' | 'user' },
  ): SafariLiveBindingRow {
    const updatedAt = new Date().toISOString();
    const url = input.url ?? '';
    const title = input.title ?? '';
    getConnection()
      .prepare(
        `INSERT INTO safari_live_bindings (session_id, window_id, page_id, url, title, bound_by, updated_at)
         VALUES (?, 0, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           window_id = 0,
           page_id = excluded.page_id,
           url = excluded.url,
           title = excluded.title,
           bound_by = excluded.bound_by,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, input.pageId, url, title, input.boundBy, updatedAt);
    return { sessionId, pageId: input.pageId, url, title, boundBy: input.boundBy, updatedAt };
  },

  /** The page went to another address: every chat bound to it keeps the new one (`updated_at` stays). */
  updatePage(pageId: string, input: { url: string; title: string }): void {
    getConnection()
      .prepare('UPDATE safari_live_bindings SET url = ?, title = ? WHERE page_id = ?')
      .run(input.url ?? '', input.title ?? '', pageId);
  },

  clear(sessionId: string): void {
    getConnection().prepare('DELETE FROM safari_live_bindings WHERE session_id = ?').run(sessionId);
  },
};
