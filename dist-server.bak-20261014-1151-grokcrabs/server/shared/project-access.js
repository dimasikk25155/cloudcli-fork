/**
 * The one rule for "may this user touch this project's sessions":
 * admins see everything, everyone else only projects an admin granted them
 * (user_project_access). The user must exist and be active, and the role is
 * read from the database — a role carried by a token or a client message can
 * never elevate access. Used by the REST session routes, the chat websocket,
 * realtime project broadcasts, the session status list, the answer path
 * (push / Telegram / UI), reply chips and memory suggestions.
 */
import { projectsDb, sessionsDb, userDb, userProjectAccessDb } from '../modules/database/index.js';
/** Active database user behind an identity, or null. */
function resolveUser(user) {
    const id = Number(user?.id ?? user?.userId);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return null;
    }
    const row = userDb.getUserById(id);
    if (!row) {
        return null;
    }
    return { id, role: typeof row.role === 'string' ? row.role : null };
}
/**
 * Is this identity an active admin? The role is read from the database; a
 * role carried by a token or a client message is ignored.
 */
export function isAdminUser(user) {
    return resolveUser(user)?.role === 'admin';
}
/**
 * Builds the access check for one user. The user and the granted list are
 * read once, so a caller filtering many rows asks the database a single time.
 */
export function projectAccessFor(user) {
    const resolved = resolveUser(user);
    if (!resolved) {
        return () => false;
    }
    if (resolved.role === 'admin') {
        return () => true;
    }
    const granted = new Set(userProjectAccessDb.getAccessibleProjectIds(resolved.id));
    return (projectId) => typeof projectId === 'string' && projectId.length > 0 && granted.has(projectId);
}
/** Same rule for a single project id (null = a session outside any project: admins only). */
export function canAccessProject(user, projectId) {
    return projectAccessFor(user)(projectId ?? null);
}
/** Project id of an app session (via its project path), or null. */
export function projectIdOfSession(appSessionId) {
    const session = sessionsDb.getSessionById(appSessionId);
    if (!session?.project_path) {
        return null;
    }
    return projectsDb.getProjectPath(session.project_path)?.project_id ?? null;
}
/**
 * Same rule, addressed by app session id. The session must exist; a session
 * without a project is visible to admins only.
 */
export function canAccessSession(user, appSessionId) {
    const session = sessionsDb.getSessionById(appSessionId);
    if (!session) {
        return false;
    }
    const projectId = session.project_path
        ? projectsDb.getProjectPath(session.project_path)?.project_id ?? null
        : null;
    return canAccessProject(user, projectId);
}
/** Name used by the wave-1 modules; identical to `canAccessSession`. */
export const canUserAccessSession = canAccessSession;
//# sourceMappingURL=project-access.js.map