import express from 'express';

import { auditDb, type AuditActor, type AuditEvent } from '@/modules/database/index.js';
import { fromMicroUsd } from '@/modules/governance/audit.service.js';
import { getSpendSummary } from '@/modules/governance/spend.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

// "Who did what, and what did it cost." Mounted behind authenticateToken in
// server/index.js, so every handler already has an authenticated req.user.
const router = express.Router();

type AuthenticatedUser = { id?: number | string; role?: string };

function readUser(req: express.Request): { id: number; role?: string } {
  const user = (req as typeof req & { user?: AuthenticatedUser }).user;
  if (user?.id === undefined || user?.id === null) {
    throw new AppError('Authentication required', { code: 'UNAUTHENTICATED', statusCode: 401 });
  }
  return { id: Number(user.id), role: user.role };
}

const KNOWN_ACTORS: AuditActor[] = [
  'user',
  'schedule',
  'pipeline',
  'telegram',
  'api',
  'git-helper',
  'system',
];

const KNOWN_EVENTS: AuditEvent[] = [
  'run.start',
  'run.finish',
  'run.error',
  'perm.requested',
  'perm.approved',
  'perm.denied',
  'perm.expired',
];

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Feed of audit events, newest first.
 *
 * Scoped to the caller unless they are an admin: on a shared instance a tenant
 * has no business reading what other tenants ran. An admin may pass `userId` to
 * look at someone specific, and omitting it shows everyone.
 */
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const user = readUser(req);
    const isAdmin = user.role === 'admin';

    const requestedUserId = readOptionalString(req.query.userId);
    const scopedUserId = isAdmin
      ? (requestedUserId ? Number(requestedUserId) : undefined)
      : user.id;

    const actor = readOptionalString(req.query.actor) as AuditActor | undefined;
    const event = readOptionalString(req.query.event) as AuditEvent | undefined;
    const beforeIdRaw = readOptionalString(req.query.beforeId);

    const events = auditDb.listEvents({
      day: readOptionalString(req.query.day),
      projectId: readOptionalString(req.query.projectId),
      userId: scopedUserId,
      actor: actor && KNOWN_ACTORS.includes(actor) ? actor : undefined,
      event: event && KNOWN_EVENTS.includes(event) ? event : undefined,
      beforeId: beforeIdRaw ? Number(beforeIdRaw) : undefined,
      limit: Number(readOptionalString(req.query.limit) ?? 100),
    });

    res.json(
      createApiSuccessResponse({
        events: events.map((row) => ({ ...row, usd: fromMicroUsd(row.cost_micro_usd) })),
        // Keyset cursor: the caller passes this back as `beforeId`.
        nextCursor: events.length > 0 ? events[events.length - 1].id : null,
      })
    );
  })
);

/** Every event belonging to one run, oldest first. */
router.get(
  '/audit/run/:runId',
  asyncHandler(async (req, res) => {
    const user = readUser(req);
    const runId = String(req.params.runId ?? '').trim();
    if (!runId) {
      throw new AppError('Invalid run id', { code: 'RUN_ID_REQUIRED', statusCode: 400 });
    }

    const timeline = auditDb.getRunTimeline(runId);

    // Ownership is decided by the rows themselves — an unknown run and someone
    // else's run are both "nothing here", so this does not leak existence.
    if (user.role !== 'admin' && timeline.some((row) => row.user_id !== user.id)) {
      throw new AppError('Run not found', { code: 'RUN_NOT_FOUND', statusCode: 404 });
    }

    res.json(
      createApiSuccessResponse({
        events: timeline.map((row) => ({ ...row, usd: fromMicroUsd(row.cost_micro_usd) })),
      })
    );
  })
);

/** Spend for today and the rolling week, plus where it went. */
router.get(
  '/spend',
  asyncHandler(async (req, res) => {
    const user = readUser(req);
    res.json(
      createApiSuccessResponse({
        spend: getSpendSummary({
          userId: user.id,
          projectId: readOptionalString(req.query.projectId),
        }),
      })
    );
  })
);

export default router;
