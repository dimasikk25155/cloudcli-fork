import { getConnection } from '../../../modules/database/connection.js';
const LINK_ROW_COLUMNS = 'session_id, provider, custom_name, project_path, parent_session_id, relation, isArchived, created_at';
// SQLite caps bound parameters per statement; sidebar pages are far below this.
const MAX_IDS_PER_QUERY = 500;
function chunk(items, size) {
    const chunks = [];
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
    getRow(sessionId) {
        const row = getConnection()
            .prepare(`SELECT ${LINK_ROW_COLUMNS} FROM sessions WHERE session_id = ? LIMIT 1`)
            .get(sessionId);
        return row ?? null;
    },
    getRows(sessionIds) {
        const unique = [...new Set(sessionIds.filter(Boolean))];
        const rows = [];
        for (const ids of chunk(unique, MAX_IDS_PER_QUERY)) {
            rows.push(...getConnection()
                .prepare(`SELECT ${LINK_ROW_COLUMNS} FROM sessions WHERE session_id IN (${ids.map(() => '?').join(',')})`)
                .all(...ids));
        }
        return rows;
    },
    /** Children of the given parents, oldest first. */
    getChildren(parentSessionIds) {
        const unique = [...new Set(parentSessionIds.filter(Boolean))];
        const rows = [];
        for (const ids of chunk(unique, MAX_IDS_PER_QUERY)) {
            rows.push(...getConnection()
                .prepare(`SELECT ${LINK_ROW_COLUMNS} FROM sessions
           WHERE parent_session_id IN (${ids.map(() => '?').join(',')})
           ORDER BY datetime(created_at) ASC, session_id ASC`)
                .all(...ids));
        }
        return rows;
    },
    setParent(childSessionId, parentSessionId, relation) {
        getConnection()
            .prepare('UPDATE sessions SET parent_session_id = ?, relation = ? WHERE session_id = ?')
            .run(parentSessionId, relation, childSessionId);
    },
};
//# sourceMappingURL=session-links.db.js.map