import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { isModOn, modOffError } from '@/shared/mods.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { DuetApi } from './duet.service.js';
import type { DuetChoice } from './duet.types.js';

type ModCheck = (userId: unknown) => boolean;

const CHOICES: ReadonlySet<string> = new Set(['restart', 'fix', 'mute', 'dismiss']);

const REFUSAL: Record<string, string> = {
  not_found: 'Решение не найдено',
  already_decided: 'Уже решено',
  bad_choice: 'Такого выбора у этого решения нет',
};

/**
 * `/api/duet` — окно «Дуэт». Монтируется за authenticateToken + requireAdmin;
 * при выключенном моде любой запрос → 409 MOD_OFF.
 */
export function createDuetRouter(
  service: () => Promise<DuetApi>,
  modOn: ModCheck = (userId) => isModOn(userId as number, 'modDuet'),
) {
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = (req as Request & { user?: { id?: unknown } }).user?.id;
    if (!modOn(userId)) {
      next(modOffError('modDuet'));
      return;
    }
    next();
  });

  router.get('/state', asyncHandler(async (_req, res) => {
    res.json(createApiSuccessResponse(await (await service()).view()));
  }));

  /** «Проверить сейчас»: проверка парка + бриф. */
  router.post('/check', asyncHandler(async (_req, res) => {
    const duet = await service();
    await duet.check();
    duet.requestBrief('manual');
    res.json(createApiSuccessResponse(await duet.view()));
  }));

  router.post('/decisions/:id/:choice', asyncHandler(async (req, res) => {
    const choice = String(req.params.choice);
    if (!CHOICES.has(choice)) throw new AppError('Неизвестный выбор', { statusCode: 400, code: 'BAD_CHOICE' });
    const result = await (await service()).decide(String(req.params.id), choice as DuetChoice, 'ui');
    if (!result.ok) throw new AppError(REFUSAL[result.reason], { statusCode: 409, code: result.reason.toUpperCase() });
    res.json(createApiSuccessResponse({ decision: result.decision }));
  }));

  router.post('/ideas/sweep', asyncHandler(async (req, res) => {
    const serviceId = typeof req.body?.serviceId === 'string' ? req.body.serviceId : undefined;
    res.json(createApiSuccessResponse({ queued: (await service()).requestIdeas(serviceId) }));
  }));

  router.post('/ideas/:id/take', asyncHandler(async (req, res) => {
    const idea = await (await service()).takeIdea(String(req.params.id));
    if (!idea) throw new AppError('Эту идею сейчас не взять', { statusCode: 409, code: 'IDEA_UNAVAILABLE' });
    res.json(createApiSuccessResponse({ idea }));
  }));

  router.post('/ideas/:id/dismiss', asyncHandler(async (req, res) => {
    const idea = await (await service()).dismissIdea(String(req.params.id));
    if (!idea) throw new AppError('Эту идею сейчас не убрать', { statusCode: 409, code: 'IDEA_UNAVAILABLE' });
    res.json(createApiSuccessResponse({ idea }));
  }));

  router.put('/settings', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<DuetApi['updateSettings']>[0] = {};
    if (typeof body.briefTime === 'string') patch.briefTime = body.briefTime;
    if (body.checkEveryMin !== undefined) patch.checkEveryMin = Number(body.checkEveryMin);
    if (body.ideasEveryDays !== undefined) patch.ideasEveryDays = Number(body.ideasEveryDays);
    if (typeof body.mute === 'string') patch.mute = body.mute;
    if (typeof body.unmute === 'string') patch.unmute = body.unmute;
    const project = body.project as { serviceId?: unknown; path?: unknown } | undefined;
    if (project && typeof project.serviceId === 'string') {
      patch.project = { serviceId: project.serviceId, path: typeof project.path === 'string' ? project.path : null };
    }
    res.json(createApiSuccessResponse({ settings: await (await service()).updateSettings(patch) }));
  }));

  return router;
}

// Боевой сервис грузится лениво: роутер не тянет за собой ssh и движки при импорте.
export default createDuetRouter(async () => (await import('./duet.runtime.js')).duetService);
