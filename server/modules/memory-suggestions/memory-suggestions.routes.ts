import express from 'express';

import { requireAdmin } from '@/middleware/auth.js';
import {
  memorySuggestions,
  type MemorySuggestionsService,
  type MemorySuggestionsUser,
} from '@/modules/memory-suggestions/memory-suggestions.service.js';
import { asyncHandler } from '@/shared/utils.js';

/**
 * Vault-note suggestions, mounted behind authenticateToken:
 *   GET  /api/memory-suggestions?sessionId=  → {suggestions: MemorySuggestionItem[]}
 *        (admins only see any; without sessionId — every open suggestion, for the hub)
 *   POST /api/memory-suggestions/:id/write   → {path, relativePath}  (admin)
 *   POST /api/memory-suggestions/:id/dismiss → {ok: true}               (admin)
 */
export function createMemorySuggestionsRouter(service: MemorySuggestionsService = memorySuggestions) {
  const router = express.Router();

  const callerOf = (req: express.Request): MemorySuggestionsUser | null => {
    const user = (req as express.Request & { user?: { id?: unknown; userId?: unknown; role?: unknown } }).user;
    const id = user?.id ?? user?.userId;
    if (typeof id !== 'number' && typeof id !== 'string') {
      return null;
    }
    return { id, role: typeof user?.role === 'string' ? user.role : null };
  };

  const idOf = (req: express.Request): number | null => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  router.get('/', (req, res) => {
    const caller = callerOf(req);
    if (!caller) {
      res.status(401).json({ error: 'Нужна авторизация' });
      return;
    }
    const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
      ? req.query.sessionId.trim()
      : undefined;
    res.json({ suggestions: service.list(caller, { sessionId }) });
  });

  router.post(
    '/:id/write',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const caller = callerOf(req);
      const id = idOf(req);
      if (!caller) {
        res.status(401).json({ error: 'Нужна авторизация' });
        return;
      }
      if (id === null) {
        res.status(400).json({ error: 'Неверный id' });
        return;
      }
      const result = await service.write(caller, id);
      switch (result.status) {
        case 'ok':
          res.json({ path: result.path, relativePath: result.relativePath });
          return;
        case 'forbidden':
          res.status(403).json({ error: 'Записывать в вольт может только админ' });
          return;
        case 'not_found':
          res.status(404).json({ error: 'Предложение не найдено' });
          return;
        case 'gone':
          res.status(409).json({ error: 'Предложение уже закрыто' });
          return;
        case 'busy':
          res.status(409).json({ error: 'Заметка уже записывается' });
          return;
        default:
          res.status(500).json({ error: result.message });
      }
    }),
  );

  router.post('/:id/dismiss', requireAdmin, (req, res) => {
    const caller = callerOf(req);
    const id = idOf(req);
    if (!caller) {
      res.status(401).json({ error: 'Нужна авторизация' });
      return;
    }
    if (id === null) {
      res.status(400).json({ error: 'Неверный id' });
      return;
    }
    const result = service.dismiss(caller, id);
    if (result.status === 'ok') {
      res.json({ ok: true });
    } else if (result.status === 'forbidden') {
      res.status(403).json({ error: 'Нет доступа к сессии' });
    } else if (result.status === 'not_found') {
      res.status(404).json({ error: 'Предложение не найдено' });
    } else {
      res.status(409).json({ error: 'Предложение уже закрыто' });
    }
  });

  return router;
}

export default createMemorySuggestionsRouter();
