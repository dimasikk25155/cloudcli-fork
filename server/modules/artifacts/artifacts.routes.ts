import express from 'express';
import mime from 'mime-types';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { ArtifactsService } from './artifacts.service.js';

type AuthedRequest = express.Request & { user?: { id?: number; userId?: number } };

const SANDBOX_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/**
 * `/api/projects/:projectId/artifacts` (mounted behind authenticateToken, mergeParams).
 * Mod «Рабочий стол» off → 409 MOD_OFF; access is the shared project rule —
 * both are checked by the service on every call. Errors are AppError and
 * reach the global error middleware.
 */
export function createArtifactsRouter(getService: () => ArtifactsService) {
  const router = express.Router({ mergeParams: true });

  const context = (req: express.Request) => {
    const user = (req as AuthedRequest).user;
    const userId = Number(user?.id ?? user?.userId);
    return { userId: Number.isFinite(userId) ? userId : -1, projectId: String((req.params as { projectId?: string }).projectId ?? '') };
  };
  const body = (req: express.Request) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {});

  router.get('/', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    res.json(createApiSuccessResponse(await getService().list(userId, projectId)));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    const input = body(req);
    res.json(createApiSuccessResponse(await getService().publish(userId, projectId, {
      path: input.path, title: input.title, sessionId: input.sessionId, messageId: input.messageId,
    })));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    res.json(createApiSuccessResponse(await getService().detail(userId, projectId, String(req.params.id))));
  }));

  router.post('/:id/refresh', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    res.json(createApiSuccessResponse(await getService().refresh(userId, projectId, String(req.params.id))));
  }));

  router.get('/:id/versions/:n/content', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    const { data, fileName } = await getService().versionContent(userId, projectId, String(req.params.id), Number(req.params.n));
    const type = mime.lookup(fileName) || 'application/octet-stream';
    // Snapshot bytes never run in the app origin: HTML comes as text, everything under a sandbox CSP.
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': SANDBOX_CSP,
      'Content-Type': /^text\/html/.test(type) ? 'text/plain; charset=utf-8' : /^text\//.test(type) ? `${type}; charset=utf-8` : type,
    });
    res.send(data);
  }));

  router.post('/:id/versions/:n/restore', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    res.json(createApiSuccessResponse(await getService().restore(userId, projectId, String(req.params.id), Number(req.params.n))));
  }));

  router.post('/:id/comments', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    const input = body(req);
    res.json(createApiSuccessResponse(getService().addComment(userId, projectId, String(req.params.id), {
      anchor: input.anchor, text: input.text, versionN: input.versionN,
    })));
  }));

  router.patch('/:id/comments/:cid', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    const input = body(req);
    res.json(createApiSuccessResponse(getService().updateComment(userId, projectId, String(req.params.id), String(req.params.cid), {
      status: input.status, text: input.text,
    })));
  }));

  router.post('/:id/send-comments', asyncHandler(async (req, res) => {
    const { userId, projectId } = context(req);
    const input = body(req);
    res.json(createApiSuccessResponse(getService().sendComments(userId, projectId, String(req.params.id), {
      sessionId: input.sessionId, commentIds: input.commentIds,
    })));
  }));

  return router;
}
