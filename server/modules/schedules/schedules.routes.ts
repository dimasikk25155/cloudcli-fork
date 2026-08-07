import express from 'express';

import {
  createSchedule,
  deleteSchedule,
  getScheduleHostStatus,
  listSchedules,
  runScheduleForActor,
  setScheduleEnabled,
  updateSchedule,
  type ScheduleActor,
} from '@/modules/schedules/schedules.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

// Recurring unattended runs. Mounted behind authenticateToken in server/index.js,
// so every handler already has an authenticated req.user.
const router = express.Router();

type AuthenticatedUser = { id?: number | string; role?: string };

function readActor(req: express.Request): ScheduleActor {
  const user = (req as typeof req & { user?: AuthenticatedUser }).user;
  if (user?.id === undefined || user?.id === null) {
    throw new AppError('Authentication required', { code: 'UNAUTHENTICATED', statusCode: 401 });
  }
  return { id: Number(user.id), role: user.role };
}

function readScheduleId(req: express.Request): number {
  const parsed = Number.parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    throw new AppError('Invalid schedule id', { code: 'SCHEDULE_INVALID', statusCode: 400 });
  }
  return parsed;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      createApiSuccessResponse({
        schedules: listSchedules(readActor(req)),
        host: getScheduleHostStatus(),
      })
    );
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const schedule = await createSchedule(readActor(req), req.body ?? {});
    res.status(201).json(createApiSuccessResponse({ schedule }));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const schedule = await updateSchedule(readActor(req), readScheduleId(req), req.body ?? {});
    res.json(createApiSuccessResponse({ schedule }));
  })
);

router.patch(
  '/:id/enabled',
  asyncHandler(async (req, res) => {
    const enabled = (req.body ?? {}).enabled;
    if (typeof enabled !== 'boolean') {
      throw new AppError('enabled must be a boolean', { code: 'SCHEDULE_INVALID', statusCode: 400 });
    }
    const schedule = await setScheduleEnabled(readActor(req), readScheduleId(req), enabled);
    res.json(createApiSuccessResponse({ schedule }));
  })
);

// Manual "run now", mainly so a user can prove the prompt works before waiting
// for the first scheduled fire.
router.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    const result = await runScheduleForActor(readActor(req), readScheduleId(req));
    res.json(createApiSuccessResponse({ run: result }));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteSchedule(readActor(req), readScheduleId(req));
    res.json(createApiSuccessResponse({ deleted: true }));
  })
);

export default router;
