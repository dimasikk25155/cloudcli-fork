import express from 'express';

import { sessionAttention, type AttentionUser } from '@/modules/session-attention/session-attention.service.js';
import { asyncHandler } from '@/shared/utils.js';

/**
 * "Ждут тебя" HTTP API. Mounted behind `authenticateToken` at `/api/attention`.
 *
 * GET  /            → { items: AttentionItem[], counts: { waiting, failed, unreadDone, working } }
 * POST /seen        { sessionIds: string[] } | { all: true } → { marked: number }
 */
const router = express.Router();

function readUser(req: express.Request): AttentionUser | null {
  const user = (req as express.Request & { user?: { id?: unknown; userId?: unknown; role?: unknown } }).user;
  const id = user?.id ?? user?.userId;
  if (typeof id !== 'number' && typeof id !== 'string') {
    return null;
  }
  return { id, role: typeof user?.role === 'string' ? user.role : null };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = readUser(req);
    if (!user) {
      res.status(401).json({ error: 'Нужна авторизация' });
      return;
    }
    const items = sessionAttention.listForUser(user);
    res.json({ items, counts: sessionAttention.countsFor(items) });
  }),
);

router.post(
  '/seen',
  asyncHandler(async (req, res) => {
    const user = readUser(req);
    if (!user) {
      res.status(401).json({ error: 'Нужна авторизация' });
      return;
    }
    const body = (req.body ?? {}) as { sessionIds?: unknown; all?: unknown };
    if (body.all === true) {
      res.json(sessionAttention.markSeen(user, { all: true }));
      return;
    }
    if (!Array.isArray(body.sessionIds)) {
      res.status(400).json({ error: 'Нужен sessionIds (массив) или all: true' });
      return;
    }
    const sessionIds = body.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    res.json(sessionAttention.markSeen(user, { sessionIds }));
  }),
);

export default router;
