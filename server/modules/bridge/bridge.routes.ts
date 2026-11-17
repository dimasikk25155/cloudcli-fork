import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import { isModOn, modOffError } from '@/shared/mods.js';

import { BRIDGE_ACTIONS, bridgeService, type BridgeAction, type BridgeService } from './bridge.service.js';

type ModCheck = (userId: unknown) => boolean;

/**
 * `/api/bridge` — мост ИИ: статус и действия пульта. Монтируется за
 * authenticateToken + requireAdmin; при выключенном моде → 409 MOD_OFF.
 */
export function createBridgeRouter(
  service: BridgeService = bridgeService,
  modOn: ModCheck = (userId) => isModOn(userId as number, 'modBridge'),
) {
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = (req as Request & { user?: { id?: unknown } }).user?.id;
    if (!modOn(userId)) {
      next(modOffError('modBridge'));
      return;
    }
    next();
  });

  router.get(
    '/state',
    asyncHandler(async (req, res) => {
      const status = await service.status(req.query.full !== '1');
      res.json(createApiSuccessResponse({ status }));
    }),
  );

  router.post(
    '/action',
    asyncHandler(async (req, res) => {
      const action = req.body?.action as BridgeAction;
      if (!BRIDGE_ACTIONS.includes(action)) {
        throw new AppError('Неизвестное действие моста', { code: 'BRIDGE_BAD_ACTION', statusCode: 400 });
      }
      res.json(createApiSuccessResponse(await service.act(action)));
    }),
  );

  return router;
}

export default createBridgeRouter();
