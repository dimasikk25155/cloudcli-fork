import express from 'express';

import { btwService, type BtwService } from '@/modules/session-links/btw.service.js';
import { getSessionLinks } from '@/modules/session-links/session-links.service.js';
import type { ProjectAccessUser } from '@/shared/project-access.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthedRequest = express.Request & { user?: ProjectAccessUser };

/**
 * `POST /:id/btw {question, quote?, provider?, model?}` → 201 `{data: BtwStartResult}`:
 * a side chat linked to `:id` as `btw`. 400 BTW_QUESTION_REQUIRED, 404/403 as
 * for links, 409 MOD_OFF (modSideChat off) / BTW_NOT_STARTED, 503 BTW_UNAVAILABLE.
 */
export function createBtwRoutes(service: BtwService): express.Router {
  const btwRouter = express.Router();
  btwRouter.post(
    '/:id/btw',
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await service.start({
        parentSessionId: String(req.params.id ?? ''),
        user: (req as AuthedRequest).user,
        question: body.question,
        quote: body.quote,
        provider: body.provider,
        model: body.model,
      });
      res.status(201).json(createApiSuccessResponse(result));
    }),
  );
  return btwRouter;
}

/**
 * Mounted at `/api/sessions` behind authenticateToken.
 * GET /:id/links → `{parent?, children[]}` (SessionLinks); 404 / 403 via AppError.
 * POST /:id/btw → a side chat (see createBtwRoutes).
 */
const router = express.Router();

router.get(
  '/:id/links',
  asyncHandler(async (req, res) => {
    res.json(getSessionLinks(String(req.params.id ?? ''), (req as AuthedRequest).user));
  }),
);

router.use(createBtwRoutes(btwService));

export default router;
