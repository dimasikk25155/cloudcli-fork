import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { isModOn, modOffError } from '@/shared/mods.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { krabikService, type KrabikService } from './krabik.service.js';

type ModCheck = (userId: unknown) => boolean;

/**
 * `/api/krabik` — окно «Агент крабик». Монтируется за authenticateToken +
 * requireAdmin; при выключенном моде любой запрос → 409 MOD_OFF.
 */
export function createKrabikRouter(
  service: KrabikService = krabikService,
  modOn: ModCheck = (userId) => isModOn(userId as number, 'modKrabikAgent'),
) {
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = (req as Request & { user?: { id?: unknown } }).user?.id;
    if (!modOn(userId)) {
      next(modOffError('modKrabikAgent'));
      return;
    }
    next();
  });

  router.get(
    '/state',
    asyncHandler(async (_req, res) => {
      const [state, messages] = await Promise.all([service.getState(), service.getMessages()]);
      res.json(createApiSuccessResponse({ ...state, messages }));
    }),
  );

  router.post(
    '/prompt',
    asyncHandler(async (req, res) => {
      await service.sendPrompt(req.body?.text);
      res.json(createApiSuccessResponse({ sent: true }));
    }),
  );

  router.post(
    '/stop',
    asyncHandler(async (_req, res) => {
      await service.stop();
      res.json(createApiSuccessResponse({ stopped: true }));
    }),
  );

  router.post(
    '/wake',
    asyncHandler(async (_req, res) => {
      res.json(createApiSuccessResponse({ result: await service.wake() }));
    }),
  );

  router.get(
    '/reports',
    asyncHandler(async (_req, res) => {
      res.json(createApiSuccessResponse({ reports: await service.listReports() }));
    }),
  );

  router.get(
    '/reports/:name',
    asyncHandler(async (req, res) => {
      res.json(createApiSuccessResponse({ name: req.params.name, text: await service.readReport(req.params.name) }));
    }),
  );

  return router;
}

export default createKrabikRouter();
