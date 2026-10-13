import express from 'express';

import { resolveRelayFile } from '@/modules/relay/relay-file.service.js';
import type { ProjectAccessUser } from '@/shared/project-access.js';
import { asyncHandler } from '@/shared/utils.js';

/**
 * Mounted at `/api/sessions` behind authenticateToken.
 * POST /:id/relay-file {path} → `{ok: true, absPath}` once the handoff note
 * is an existing file strictly inside the chat's project; refusals via AppError.
 */
const router = express.Router();

router.post(
  '/:id/relay-file',
  asyncHandler(async (req, res) => {
    const user = (req as express.Request & { user?: ProjectAccessUser }).user;
    res.json(await resolveRelayFile({
      sessionId: String(req.params.id ?? ''),
      requestedPath: (req.body as { path?: unknown } | undefined)?.path,
      user,
    }));
  }),
);

export default router;
