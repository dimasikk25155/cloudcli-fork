import express from 'express';

import {
  replySuggestions,
  type ReplySuggestionsService,
  type ReplySuggestionsUser,
} from '@/modules/reply-suggestions/reply-suggestions.service.js';
import { asyncHandler } from '@/shared/utils.js';

/**
 * POST /api/reply-suggestions {sessionId, replyHash} → {suggestions: string[]} (0 or 2–3, ≤60 chars each).
 * `replyHash` = replyFingerprint() of the reply on screen (shared/reply-fingerprint.ts).
 * Mounted behind authenticateToken. A missing or confused local model is an
 * empty list, not an error: the composer just shows no chips.
 */
export function createReplySuggestionsRouter(service: ReplySuggestionsService = replySuggestions) {
  const router = express.Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = (req as express.Request & { user?: { id?: unknown; userId?: unknown; role?: unknown } }).user;
      const id = user?.id ?? user?.userId;
      if (typeof id !== 'number' && typeof id !== 'string') {
        res.status(401).json({ error: 'Нужна авторизация' });
        return;
      }
      const body = (req.body ?? {}) as { sessionId?: unknown; replyHash?: unknown };
      const { sessionId, replyHash } = body;
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        res.status(400).json({ error: 'Нужен sessionId' });
        return;
      }
      if (typeof replyHash !== 'string' || !replyHash.trim()) {
        res.status(400).json({ error: 'Нужен replyHash' });
        return;
      }

      const caller: ReplySuggestionsUser = { id, role: typeof user?.role === 'string' ? user.role : null };
      const result = await service.suggest(caller, sessionId.trim(), replyHash.trim());
      if (result.status === 'not_found') {
        res.status(404).json({ error: 'Сессия не найдена' });
        return;
      }
      if (result.status === 'forbidden') {
        res.status(403).json({ error: 'Нет доступа к сессии' });
        return;
      }
      res.json({ suggestions: result.suggestions });
    }),
  );

  return router;
}

export default createReplySuggestionsRouter();
