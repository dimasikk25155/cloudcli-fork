import express from 'express';

import { autoRelayService, type AutoRelayService } from '@/modules/auto-relay/auto-relay.service.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';
import { asyncHandler } from '@/shared/utils.js';

type AuthedRequest = express.Request & { user?: { id?: unknown } };

function userIdOf(req: express.Request): number | null {
  const id = Number((req as AuthedRequest).user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Mounted at `/api/sessions` behind authenticateToken; every route checks
 * the chat's project access (requireSessionAccess).
 * GET /:sessionId/auto-relay → AutoRelayStatus
 * PUT /:sessionId/auto-relay {enabled: boolean} → AutoRelayStatus
 */
export function createAutoRelayRoutes(service: AutoRelayService = autoRelayService): express.Router {
  const router = express.Router();

  router.get('/:sessionId/auto-relay', requireSessionAccess, (req, res) => {
    res.json(service.getStatus(String(req.params.sessionId)));
  });

  router.put(
    '/:sessionId/auto-relay',
    requireSessionAccess,
    asyncHandler(async (req, res) => {
      const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled должен быть true или false' });
        return;
      }
      res.json(service.setEnabled(String(req.params.sessionId), enabled, userIdOf(req)));
    }),
  );

  return router;
}

export default createAutoRelayRoutes();
