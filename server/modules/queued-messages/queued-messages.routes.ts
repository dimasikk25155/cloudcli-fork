import express from 'express';

import type { QueuedMessagesService, QueuedPutInput } from '@/modules/queued-messages/queued-messages.service.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';
import { asyncHandler } from '@/shared/utils.js';

type AuthedRequest = express.Request & { user?: { id?: unknown; userId?: unknown } };

/** The authenticated user of the request — the one the message is queued and sent for. */
function userIdOf(req: express.Request): number | null {
  const user = (req as AuthedRequest).user;
  const id = Number(user?.id ?? user?.userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Mounted at `/api/sessions` behind authenticateToken; every route checks the
 * chat's project access (requireSessionAccess: 404 unknown chat, 403 no access).
 *
 * GET    /:sessionId/queued-message          → { queued: QueuedMessage | null }
 * PUT    /:sessionId/queued-message          { content, options?, images? } → { queued, sent }
 *        (no live turn and no open question → sent at once: `sent: true`, `queued: null`;
 *        empty content without pictures → 400)
 * DELETE /:sessionId/queued-message          → { ok: true }
 * POST   /:sessionId/queued-message/send-now → { ok: true, sent, queued }
 *        (a live turn is stopped by the server, then the message is sent)
 */
export function createQueuedMessagesRoutes(service: QueuedMessagesService): express.Router {
  const router = express.Router();

  router.get('/:sessionId/queued-message', requireSessionAccess, (req, res) => {
    res.json({ queued: service.get(String(req.params.sessionId)) });
  });

  router.put(
    '/:sessionId/queued-message',
    requireSessionAccess,
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as QueuedPutInput;
      res.json(await service.put(String(req.params.sessionId), userIdOf(req), {
        content: body.content,
        options: body.options,
        images: body.images,
      }));
    }),
  );

  router.delete('/:sessionId/queued-message', requireSessionAccess, (req, res) => {
    service.clear(String(req.params.sessionId));
    res.json({ ok: true });
  });

  router.post(
    '/:sessionId/queued-message/send-now',
    requireSessionAccess,
    asyncHandler(async (req, res) => {
      const result = await service.sendNow(String(req.params.sessionId), userIdOf(req));
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
