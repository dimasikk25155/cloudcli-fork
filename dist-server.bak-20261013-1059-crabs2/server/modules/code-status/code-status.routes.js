import express from 'express';
import { codeStatus } from '../../modules/code-status/code-status.service.js';
import { projectsDb } from '../../modules/database/index.js';
import { canAccessProject, isAdminUser } from '../../shared/project-access.js';
import { asyncHandler } from '../../shared/utils.js';
/**
 * GET /api/projects/:projectId/code-status[?refresh=1] → CodeStatus.
 * Mounted behind authenticateToken. Access is the shared project rule; the
 * site part (Dima's Vercel token) is for admins only, and the role is read
 * from the database, never from the token.
 */
export function createCodeStatusRouter(service = codeStatus) {
    const router = express.Router({ mergeParams: true });
    router.get('/', asyncHandler(async (req, res) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Нужна авторизация' });
            return;
        }
        const projectId = String(req.params.projectId ?? '');
        const projectPath = projectId ? projectsDb.getProjectPathById(projectId) : null;
        if (!projectPath) {
            res.status(404).json({ error: 'Проект не найден' });
            return;
        }
        if (!canAccessProject(user, projectId)) {
            res.status(403).json({ error: 'Нет доступа к проекту' });
            return;
        }
        // Сайт проверяется токеном Димы — только админу, роль из БД.
        const isAdmin = isAdminUser(user);
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
        res.json(await service.getCodeStatus(projectPath, { isAdmin, refresh }));
    }));
    return router;
}
export default createCodeStatusRouter();
//# sourceMappingURL=code-status.routes.js.map