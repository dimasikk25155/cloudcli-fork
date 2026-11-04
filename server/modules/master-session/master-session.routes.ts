import express from 'express';
import type { Request } from 'express';

import type { AttentionUser } from '@/modules/session-attention/index.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { MasterSessionService } from './master-session.service.js';

/**
 * `/api/master-session` (за authenticateToken в `server/index.js`):
 *
 * GET  /questions                  → {success, data:{questions: MasterQuestion[]}}
 * POST /drafts {sessionIds[]}      → {success, data:{drafts:[{sessionId, text, choice?, updatedAt}]}}
 * POST /send   {batchId, items[]}  → {success, data:{results:[{sessionId, status, reason?}]}}
 *
 * Мод «Панель диалогов» выключен → 409 MOD_OFF (решает сервис).
 */
function readUser(req: Request): AttentionUser {
  const user = (req as Request & { user?: { id?: unknown; userId?: unknown; role?: unknown } }).user;
  const id = user?.id ?? user?.userId;
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new AppError('Нужна авторизация', { code: 'UNAUTHORIZED', statusCode: 401 });
  }
  return { id, role: typeof user?.role === 'string' ? user.role : null };
}

export function createMasterSessionRouter(service: () => MasterSessionService): express.Router {
  const router = express.Router();

  router.get('/questions', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ questions: service().listQuestions(readUser(req)) }));
  }));

  router.post('/drafts', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { sessionIds?: unknown };
    res.json(createApiSuccessResponse(await service().prepareDrafts(readUser(req), { sessionIds: body.sessionIds })));
  }));

  router.post('/send', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { batchId?: unknown; items?: unknown };
    res.json(createApiSuccessResponse(await service().send(readUser(req), { batchId: body.batchId, items: body.items })));
  }));

  return router;
}
