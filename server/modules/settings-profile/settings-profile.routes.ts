import express from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { SettingsProfileService } from './settings-profile.service.js';

type AuthedRequest = express.Request & { user?: { id?: number; userId?: number } };

/**
 * `/api/settings-profile` (behind authenticateToken). Mod «Диагностика» off →
 * 409 MOD_OFF. Applying and restoring are human actions: the agent's only way
 * in is `workspace_action settings.propose`.
 */
export function createSettingsProfileRouter(getService: () => SettingsProfileService) {
  const router = express.Router();
  const userOf = (req: express.Request) => {
    const user = (req as AuthedRequest).user;
    const id = Number(user?.id ?? user?.userId);
    return Number.isFinite(id) ? id : -1;
  };
  const body = (req: express.Request) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {});

  router.get('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().overview(userOf(req))));
  }));
  router.post('/preview', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().preview(userOf(req), body(req).changes)));
  }));
  router.post('/apply', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().apply(userOf(req), body(req))));
  }));
  router.post('/restore', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().restore(userOf(req), body(req).snapshotId)));
  }));
  router.post('/proposals/:id/dismiss', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(getService().dismiss(userOf(req), req.params.id)));
  }));

  return router;
}
