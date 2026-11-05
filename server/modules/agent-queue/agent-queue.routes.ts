import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { isModActive, modOffError } from '@/shared/mods.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { AgentQueueService } from './agent-queue.service.js';

export type AgentQueueRouterOptions = {
  service: AgentQueueService;
  /** «Конвейер» works for this user (default: `modAgentQueue` with `modAgents`). */
  modOn?: (userId: unknown) => boolean;
};

type AuthedRequest = Request & { user?: { id?: unknown } };

function userIdOf(req: Request): number {
  return Number((req as AuthedRequest).user?.id);
}

/**
 * `/api/agent-queue` — mounted behind authenticateToken + requireAdmin.
 * Mod «Конвейер» (or «Агенты» it requires) off → 409 MOD_OFF.
 */
export function createAgentQueueRouter(options: AgentQueueRouterOptions) {
  const { service } = options;
  const modOn = options.modOn ?? ((userId: unknown) => isModActive(userId as number, 'modAgentQueue'));
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!modOn((req as AuthedRequest).user?.id)) {
      next(modOffError('modAgentQueue'));
      return;
    }
    next();
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queues: service.list(userIdOf(req)) }));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.create(userIdOf(req), req.body ?? {}) }));
  }));

  router.post('/items/:itemId/mark-ok', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: await service.markOk(userIdOf(req), req.params.itemId) }));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.get(userIdOf(req), String(req.params.id)) }));
  }));

  router.post('/:id/pause', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.pause(userIdOf(req), String(req.params.id)) }));
  }));

  router.post('/:id/resume', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.resume(userIdOf(req), String(req.params.id)) }));
  }));

  router.post('/:id/stop', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.stop(userIdOf(req), String(req.params.id)) }));
  }));

  router.post('/:id/retry-rejected', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ queue: service.retryRejected(userIdOf(req), String(req.params.id)) }));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    service.remove(userIdOf(req), String(req.params.id));
    res.json(createApiSuccessResponse({ removed: true }));
  }));

  return router;
}
