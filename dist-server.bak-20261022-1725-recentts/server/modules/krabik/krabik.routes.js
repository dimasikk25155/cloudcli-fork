import express from 'express';
import { isModOn, modOffError } from '../../shared/mods.js';
import { asyncHandler, createApiSuccessResponse } from '../../shared/utils.js';
import { krabikService } from './krabik.service.js';
/**
 * `/api/krabik` — окно «Агент крабик». Монтируется за authenticateToken +
 * requireAdmin; при выключенном моде любой запрос → 409 MOD_OFF.
 */
export function createKrabikRouter(service = krabikService, modOn = (userId) => isModOn(userId, 'modKrabikAgent')) {
    const router = express.Router();
    router.use((req, _res, next) => {
        const userId = req.user?.id;
        if (!modOn(userId)) {
            next(modOffError('modKrabikAgent'));
            return;
        }
        next();
    });
    router.get('/state', asyncHandler(async (_req, res) => {
        const [state, messages] = await Promise.all([service.getState(), service.getMessages()]);
        res.json(createApiSuccessResponse({ ...state, messages }));
    }));
    router.post('/prompt', asyncHandler(async (req, res) => {
        await service.sendPrompt(req.body?.text);
        res.json(createApiSuccessResponse({ sent: true }));
    }));
    router.post('/stop', asyncHandler(async (_req, res) => {
        await service.stop();
        res.json(createApiSuccessResponse({ stopped: true }));
    }));
    router.post('/wake', asyncHandler(async (_req, res) => {
        res.json(createApiSuccessResponse({ result: await service.wake() }));
    }));
    router.get('/reports', asyncHandler(async (_req, res) => {
        res.json(createApiSuccessResponse({ reports: await service.listReports() }));
    }));
    router.get('/reports/:name', asyncHandler(async (req, res) => {
        res.json(createApiSuccessResponse({ name: req.params.name, text: await service.readReport(req.params.name) }));
    }));
    return router;
}
export default createKrabikRouter();
//# sourceMappingURL=krabik.routes.js.map