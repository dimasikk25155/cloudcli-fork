import { getConnection } from '@/modules/database/connection.js';

/** One session row as the chat-links module sees it. */
export type SessionLinkRow = {
  session_id: string;
  provider: string;
  custom_name: string | null;
  project_path: string | null;
  parent_session_id: string | null;
  relation: string | null;
  isArchived: number;
  created_at: string | null;
};

const LINK_ROW_COLUMNS =
  'session_id, provider, custom_name, project_path, parent_session_id, relation, isArchived, created_at';

// SQLite caps bound parameters per statement; sidebar pages are far below this.
const MAX_IDS_PER_QUERY = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Storage of chat links: `sessions.parent_session_id` + `sessions.relation`.
 * Validation (access, same project, relation values) lives in the
 * session-links module; this repository only reads and writes the columns.
 */
export const sessionLinksDb = {
  getRow(sessionId: string): SessionLinkRow | null {
    const row = getConnection()
      .prepare(`SELECT ${LINK_ROW_COLUMNS} FROM sessions WHERE session_id = ? LIMIT 1`)
      .get(sessionId) as SessionLinkRow | undefined;
    return row ?? null;
  },

  getRows(sessionIds: string[]): SessionLinkRow[] {
    const unique = [...new Set(sessionIds.filter(Boolean))];
    const rows: SessionLinkRow[] = [];
    for (const ids of chunk(unique, MAX_IDS_PER_QUERY)) {
      rows.push(...(getConnection()
        .prepare(`SELECT ${LINK_ROW_COLUMNS} FROM sessions WHERE session_id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids) as SessionLinkRow[]));
    }
    return rows;
  },

  /** Children of the given parents, oldest first. */
  getChildren(parentSessionIds: string[]): SessionLinkRow[] {
    const unique = [...new Set(parentSessionIds.filter(Boolean))];
    const rows: SessionLinkRow[] = [];
    for (const ids of chunk(unique, MAX_IDS_PER_QUERY)) {
      rows.push(...(getConnection()
        .prepare(
          `SELECT ${LINK_ROW_COLUMNS} FROM sessions
           WHERE parent_session_id IN (${ids.map(() => '?').join(',')})
           ORDER BY datetime(created_at) ASC, session_id ASC`,
        )
        .all(...ids) as SessionLinkRow[]));
    }
    return rows;
  },

  setParent(childSessionId: string, parentSessionId: string, relation: string): void {
    getConnection()
      .prepare('UPDATE sessions SET parent_session_id = ?, relation = ? WHERE session_id = ?')
      .run(parentSessionId, relation, childSessionId);
  },
};
