import { getConnection } from '@/modules/database/connection.js';

export const userProjectAccessDb = {
  /** Grants a user access to a project. Idempotent — re-granting is a no-op. */
  grantAccess(userId: number, projectId: string, grantedBy: number | null): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO user_project_access (user_id, project_id, granted_by)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, project_id) DO NOTHING
    `).run(userId, projectId, grantedBy);
  },

  /** Revokes a user's access to a project. */
  revokeAccess(userId: number, projectId: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM user_project_access WHERE user_id = ? AND project_id = ?').run(userId, projectId);
  },

  /** Returns the project ids a user has been explicitly granted access to. */
  getAccessibleProjectIds(userId: number): string[] {
    const db = getConnection();
    const rows = db
      .prepare('SELECT project_id FROM user_project_access WHERE user_id = ?')
      .all(userId) as { project_id: string }[];
    return rows.map((row) => row.project_id);
  },

  /**
   * Replaces a user's entire project access set in one transaction — used by
   * the admin "manage access" checkbox UI, which always submits the full
   * desired set rather than individual grant/revoke calls.
   */
  setAccessibleProjectIds(userId: number, projectIds: string[], grantedBy: number | null): void {
    const db = getConnection();
    const replace = db.transaction((ids: string[]) => {
      db.prepare('DELETE FROM user_project_access WHERE user_id = ?').run(userId);
      const insert = db.prepare(`
        INSERT INTO user_project_access (user_id, project_id, granted_by)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, project_id) DO NOTHING
      `);
      for (const projectId of ids) {
        insert.run(userId, projectId, grantedBy);
      }
    });
    replace(projectIds);
  },
};
