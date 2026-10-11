/**
 * The one rule for "may this user touch this project's sessions":
 * admins see everything, everyone else only projects an admin granted them
 * (user_project_access). Used by the session status list, the answer path
 * (push / Telegram / UI) and the chat websocket.
 */

import { projectsDb, sessionsDb, userProjectAccessDb } from '@/modules/database/index.js';

export type ProjectAccessUser = { id: number | string | null | undefined; role?: string | null };

function toUserId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Builds the access check for one user. The granted list is read once, so a
 * caller filtering many rows asks the database a single time.
 */
export function projectAccessFor(user: ProjectAccessUser): (projectId: string | null | undefined) => boolean {
  if (user.role === 'admin') {
    return () => true;
  }
  const userId = toUserId(user.id);
  if (userId === null) {
    return () => false;
  }
  const granted = new Set(userProjectAccessDb.getAccessibleProjectIds(userId));
  return (projectId) => typeof projectId === 'string' && projectId.length > 0 && granted.has(projectId);
}

/** Project id of an app session (via its project path), or null. */
export function projectIdOfSession(appSessionId: string): string | null {
  const session = sessionsDb.getSessionById(appSessionId);
  if (!session?.project_path) {
    return null;
  }
  return projectsDb.getProjectPath(session.project_path)?.project_id ?? null;
}

/** Same rule, addressed by app session id. Unknown session: admins only. */
export function canUserAccessSession(user: ProjectAccessUser, appSessionId: string): boolean {
  return projectAccessFor(user)(projectIdOfSession(appSessionId));
}
