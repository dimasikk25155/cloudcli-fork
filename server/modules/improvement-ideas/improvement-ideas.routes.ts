import express from 'express';

import { isAdminUser } from '@/shared/project-access.js';
import { asyncHandler } from '@/shared/utils.js';

import { IdeaError, improvementIdeas, type ImprovementIdeasService } from './improvement-ideas.service.js';

export function createImprovementIdeasRouter(service: ImprovementIdeasService = improvementIdeas) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!isAdminUser((req as express.Request & { user?: { id?: number; userId?: number } }).user)) {
      res.status(403).json({ error: 'Идеи доступны только администратору' }); return;
    }
    next();
  });
  router.use(asyncHandler(async (req, res, next) => {
    try {
      const userId = Number((req as express.Request & { user?: { id?: number; userId?: number } }).user?.id
        ?? (req as express.Request & { user?: { userId?: number } }).user?.userId);
      if (req.method === 'GET' && req.path === '/') {
        if (typeof req.query.sessionId !== 'string') { res.status(400).json({ error: 'Нужен чат' }); return; }
        res.json({ ideas: service.list(userId, req.query.sessionId) }); return;
      }
      const match = /^\/(\d+)\/(decision|sync)$/.exec(req.path);
      if (!match || req.method !== 'POST') { next(); return; }
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id) || id < 1) throw new IdeaError(400, 'Неверная идея');
      if (match[2] === 'sync') { res.json({ idea: await service.sync(userId, id) }); return; }
      const action = req.body?.action;
      if (action !== 'implement' && action !== 'later') throw new IdeaError(400, 'Неверное действие');
      res.json({ idea: await service.decide(userId, id, action) });
    } catch (error) {
      if (error instanceof IdeaError) { res.status(error.statusCode).json({ error: error.message }); return; }
      throw error;
    }
  }));
  return router;
}
