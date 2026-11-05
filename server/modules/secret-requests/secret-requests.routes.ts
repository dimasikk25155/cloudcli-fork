import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { isModOn, modOffError } from '@/shared/mods.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { SecretRequestsService } from './secret-requests.service.js';

export type SecretRequestsRouterOptions = {
  service: SecretRequestsService;
  /** «Запрос ключа» works for this user (default: `modSecretRequest`). */
  modOn?: (userId: unknown) => boolean;
};

type AuthedRequest = Request & { user?: { id?: unknown } };

function userIdOf(req: Request): number {
  return Number((req as AuthedRequest).user?.id);
}

/**
 * `/api/secret-requests` — mounted behind authenticateToken + requireAdmin.
 *
 * - `GET /` → `{requests: SecretRequestView[]}` — names and reasons, never values;
 * - `POST /:id {value, replace?}` → `{name, message}` — the value goes to the
 *   secrets file and is dropped from the request body right after;
 * - `POST /:id/decline` → `{message}`.
 *
 * Mod «Запрос ключа» off → 409 MOD_OFF.
 */
export function createSecretRequestsRouter(options: SecretRequestsRouterOptions) {
  const { service } = options;
  const modOn = options.modOn ?? ((userId: unknown) => isModOn(userId as number, 'modSecretRequest'));
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!modOn((req as AuthedRequest).user?.id)) {
      next(modOffError('modSecretRequest'));
      return;
    }
    next();
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ requests: await service.list(userIdOf(req)) }));
  }));

  router.post('/:id/decline', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(service.decline(userIdOf(req), String(req.params.id))));
  }));

  router.post('/:id', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { value?: unknown; replace?: unknown };
    const input = { value: body.value, replace: body.replace };
    // The body object outlives this handler in middleware closures; keep the value out of it.
    if (req.body && typeof req.body === 'object') delete (req.body as { value?: unknown }).value;
    res.json(createApiSuccessResponse(await service.answer(userIdOf(req), String(req.params.id), input)));
  }));

  return router;
}
