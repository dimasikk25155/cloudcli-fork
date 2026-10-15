import { sessionsDb } from '../modules/database/index.js';
import { canAccessSession } from '../shared/project-access.js';
/**
 * Express guard for routes addressed by `:sessionId`: 404 for an unknown
 * session, 403 unless the shared project rule lets this user open it. The
 * role comes from the database, not from the token. Put it after
 * authenticateToken.
 */
export function requireSessionAccess(req, res, next) {
    const sessionId = String(req.params.sessionId ?? '');
    if (!sessionId || !sessionsDb.getSessionById(sessionId)) {
        res.status(404).json({ error: 'Session not found', sessionId });
        return;
    }
    const user = req.user;
    if (!canAccessSession({ id: user?.id, userId: user?.userId }, sessionId)) {
        res.status(403).json({ error: 'Нет доступа к сессии' });
        return;
    }
    next();
}
//# sourceMappingURL=require-session-access.js.map