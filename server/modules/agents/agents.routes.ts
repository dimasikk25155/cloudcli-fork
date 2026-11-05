import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { isModOn, modOffError } from '@/shared/mods.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { agentsService, type AgentsService } from './agents.service.js';

export type AgentsRouterOptions = {
  service?: AgentsService;
  /** «Агенты» on for this user (default: the account switch `modAgents`). */
  modOn?: (userId: unknown) => boolean;
  /** Default `requireSessionAccess` (404 unknown chat, 403 foreign chat). */
  sessionAccess?: RequestHandler;
};

type AuthedRequest = Request & { user?: { id?: unknown } };

function userIdOf(req: Request): number {
  return Number((req as AuthedRequest).user?.id);
}

/**
 * `/api/agents` — mounted behind authenticateToken + requireAdmin.
 * Mod «Агенты» off → 409 MOD_OFF for every request.
 */
export function createAgentsRouter(options: AgentsRouterOptions = {}) {
  const service = options.service ?? agentsService;
  const modOn = options.modOn ?? ((userId: unknown) => isModOn(userId as number, 'modAgents'));
  const sessionAccess = options.sessionAccess ?? requireSessionAccess;
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!modOn((req as AuthedRequest).user?.id)) {
      next(modOffError('modAgents'));
      return;
    }
    next();
  });

  router.get('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ agents: service.list(userIdOf(req)) }));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ agent: await service.create(userIdOf(req), req.body ?? {}) }));
  }));

  router.get('/by-session/:sessionId', sessionAccess, asyncHandler(async (req, res) => {
    const agent = service.agentOfSession(String(req.params.sessionId));
    res.json(createApiSuccessResponse({ agent }));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ agent: service.get(userIdOf(req), String(req.params.id)) }));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse({ agent: await service.update(userIdOf(req), String(req.params.id), req.body ?? {}) }));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    service.remove(userIdOf(req), String(req.params.id));
    res.json(createApiSuccessResponse({ removed: true }));
  }));

  router.get('/:id/rules', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(service.rules(userIdOf(req), String(req.params.id))));
  }));

  router.post('/:id/rules', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(service.addRule(userIdOf(req), String(req.params.id), req.body?.text, 'user')));
  }));

  router.delete('/:id/rules/:ruleId', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(service.removeRule(userIdOf(req), String(req.params.id), req.params.ruleId)));
  }));

  router.post('/:id/chat', asyncHandler(async (req, res) => {
    res.json(createApiSuccessResponse(await service.startChat(userIdOf(req), String(req.params.id), req.body?.task)));
  }));

  return router;
}

export default createAgentsRouter();
