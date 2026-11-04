import express from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { SidebarGroupsService } from './sidebar-groups.service.js';

type AuthedRequest = express.Request & { user?: { id?: number; userId?: number } };

/**
 * `/api/sidebar-groups` (behind authenticateToken). Switch «Группы» off → 409
 * MOD_OFF (the service checks on every call). Everything is scoped to the
 * caller; another user's group answers 404.
 */
export function createSidebarGroupsRouter(getService: () => SidebarGroupsService) {
  const router = express.Router();
  const userOf = (req: express.Request) => {
    const user = (req as AuthedRequest).user;
    const id = Number(user?.id ?? user?.userId);
    return Number.isFinite(id) ? id : -1;
  };
  const body = (req: express.Request) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {});

  router.get('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().list(userOf(req))));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().create(userOf(req), body(req))));
  }));

  router.put('/order', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().reorder(userOf(req), body(req).ids)));
  }));

  router.put('/pins/:sessionId', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().setPin(userOf(req), req.params.sessionId, true)));
  }));

  router.delete('/pins/:sessionId', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().setPin(userOf(req), req.params.sessionId, false)));
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().update(userOf(req), req.params.id, body(req))));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().remove(userOf(req), req.params.id)));
  }));

  router.put('/:id/items', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().setItems(userOf(req), req.params.id, body(req).items)));
  }));

  return router;
}
