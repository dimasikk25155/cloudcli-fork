import os from 'node:os';

import express from 'express';
import type { Request } from 'express';

import { sessionsDb } from '@/modules/database/index.js';
import { checkUsageGuard, formatResetMoscow } from '@/shared/claude-usage.js';
import { isModOn as defaultIsModOn, modOffError } from '@/shared/mods.js';
import type { IsModOn } from '@/shared/mods.js';
import { canAccessSession, isAdminUser } from '@/shared/project-access.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { createAdvisor } from './advisor.service.js';
import type { AdvisorService } from './advisor.service.js';
import { createDoctor } from './doctor.js';
import { realExec, realFs } from './diagnostics.runtime.js';
import type { DoctorReport, SkillReport } from './diagnostics.types.js';
import { createSkillDoctor } from './skill-doctor.js';

export type DiagnosticsApi = {
  runDoctor: () => Promise<DoctorReport>;
  runSkillDoctor: () => Promise<SkillReport>;
  advisor: Pick<AdvisorService, 'ask'>;
  isAdmin: (user: unknown) => boolean;
  isModOn: IsModOn;
};

export function createDefaultDiagnostics(): DiagnosticsApi {
  const home = os.homedir();
  const doctor = createDoctor({ exec: realExec, fs: realFs, home, databasePath: process.env.DATABASE_PATH || undefined });
  const skills = createSkillDoctor({ fs: realFs, home });
  const advisor = createAdvisor({
    isModOn: defaultIsModOn,
    canAccessSession: (user, sessionId) => canAccessSession(user as never, sessionId),
    projectPathOf: (sessionId) => sessionsDb.getSessionById(sessionId)?.project_path ?? null,
    fetchMessages: async (sessionId) => {
      const { sessionsService } = await import('@/modules/providers/index.js');
      const history = await sessionsService.fetchHistory(sessionId, { limit: 60, offset: 0 });
      return history.messages as never;
    },
    runAgent: async ({ projectPath, prompt, userId, model }) => {
      const { runHeadlessPrompt } = await import('@/modules/agent-run/index.js');
      const result = await runHeadlessPrompt({ projectPath, prompt, userId, provider: 'claude', model, actor: 'user', readOnly: true });
      return { text: String(result.text ?? '') };
    },
    usageBlocked: async () => {
      const guard = await checkUsageGuard();
      if (!guard.blocked) return null;
      return `лимит подписки Claude${guard.pct === null ? '' : ` ${Math.round(guard.pct)}%`}, сброс в ${formatResetMoscow(guard.resetsAt)}`;
    },
  });
  return {
    runDoctor: () => doctor.runDoctor(),
    runSkillDoctor: () => skills.runSkillDoctor(),
    advisor,
    isAdmin: (user) => isAdminUser(user as never),
    isModOn: defaultIsModOn,
  };
}

/**
 * `/api/diagnostics` — mounted behind authenticateToken only. The two reports
 * are admin-only (checked here); `/advisor` is open to every signed-in user
 * with access to the chat. Every route needs the `modDiagnostics` mod.
 */
export function createDiagnosticsRouter(api: () => DiagnosticsApi = createDefaultDiagnostics) {
  const router = express.Router();
  let cached: DiagnosticsApi | null = null;
  const get = () => (cached ??= api());

  const user = (req: Request) => (req as Request & { user?: { id?: number | string } }).user;

  router.use((req, _res, next) => {
    if (!get().isModOn(Number(user(req)?.id), 'modDiagnostics')) {
      next(modOffError('modDiagnostics'));
      return;
    }
    next();
  });

  const adminOnly = (req: Request) => {
    if (!get().isAdmin(user(req))) {
      throw new AppError('Отчёт доступен только администратору.', { code: 'FORBIDDEN', statusCode: 403 });
    }
  };

  router.get('/doctor', asyncHandler(async (req, res) => {
    adminOnly(req);
    res.json(createApiSuccessResponse(await get().runDoctor()));
  }));

  router.get('/skill-doctor', asyncHandler(async (req, res) => {
    adminOnly(req);
    res.json(createApiSuccessResponse(await get().runSkillDoctor()));
  }));

  router.post('/advisor', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { sessionId?: unknown; question?: unknown };
    const result = await get().advisor.ask({ user: user(req), sessionId: body.sessionId, question: body.question });
    res.json(createApiSuccessResponse(result));
  }));

  return router;
}

export const diagnosticsRoutes = createDiagnosticsRouter();
