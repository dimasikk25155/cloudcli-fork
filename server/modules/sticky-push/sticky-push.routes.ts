import express from 'express';

import { authenticateToken } from '@/middleware/auth.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';
import {
  completeConsigliereTask,
  completePlannerItem,
  loadPlanner,
  stickyPushTokenMatches,
  syncConsigliereEvents,
  type PlannerDoneKind,
  type StickyEvent,
} from '@/modules/sticky-push/sticky-push.service.js';
import { verifyDoneSig } from '@/modules/sticky-push/sticky-push.service.js';
import { readPushPolicy } from '@/modules/sticky-push/push-policy.js';

const router = express.Router();

function readToken(req: express.Request): string | undefined {
  return req.get('X-Token') ?? req.get('x-token') ?? undefined;
}

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    if (!stickyPushTokenMatches(readToken(req))) {
      throw new AppError('Неверный токен пуша', { code: 'STICKY_PUSH_FORBIDDEN', statusCode: 403 });
    }
    const body = (req.body ?? {}) as { events?: unknown };
    const events = Array.isArray(body.events) ? body.events : [];
    const cleaned: StickyEvent[] = [];
    for (const item of events) {
      if (!item || typeof item !== 'object') continue;
      const row = Number((item as StickyEvent).row);
      const kind = (item as StickyEvent).kind;
      if (!Number.isInteger(row) || row < 2) continue;
      if (kind !== 'due' && kind !== 'overdue') continue;
      cleaned.push({
        row,
        title: String((item as StickyEvent).title || 'Задача'),
        date: String((item as StickyEvent).date || ''),
        time: String((item as StickyEvent).time || ''),
        kind,
      });
    }
    const result = await syncConsigliereEvents(cleaned);
    res.json(createApiSuccessResponse({ ...result, policy: readPushPolicy().consigliere }));
  }),
);

router.post(
  '/done',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { row?: unknown; sig?: unknown };
    const row = Number(body.row);
    const sig = typeof body.sig === 'string' ? body.sig : '';
    if (!Number.isInteger(row) || row < 2 || !verifyDoneSig(row, sig)) {
      throw new AppError('Нельзя закрыть задачу: подпись не сошлась', {
        code: 'STICKY_PUSH_BAD_SIG',
        statusCode: 403,
      });
    }
    await completeConsigliereTask(row);
    res.json(createApiSuccessResponse({ ok: true, row }));
  }),
);

router.get(
  '/planner',
  authenticateToken,
  asyncHandler(async (_req, res) => {
    try {
      const planner = await loadPlanner();
      res.json(createApiSuccessResponse(planner));
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Не удалось прочитать канцелярию',
        { code: 'PLANNER_READ_FAILED', statusCode: 502 },
      );
    }
  }),
);

router.post(
  '/planner/done',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { kind?: unknown; row?: unknown };
    const kind = body.kind === 'sub' ? 'sub' : body.kind === 'event' ? 'event' : '';
    const row = Number(body.row);
    if (!kind || !Number.isInteger(row) || row < 2) {
      throw new AppError('Нужны kind (event/sub) и номер строки', {
        code: 'PLANNER_BAD_ITEM',
        statusCode: 400,
      });
    }
    try {
      await completePlannerItem(kind as PlannerDoneKind, row);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Не удалось отметить задачу',
        { code: 'PLANNER_DONE_FAILED', statusCode: 502 },
      );
    }
    res.json(createApiSuccessResponse({ ok: true, kind, row }));
  }),
);

export default router;
