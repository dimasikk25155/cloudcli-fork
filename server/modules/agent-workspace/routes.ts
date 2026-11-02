import { Router, type Request, type Response, type NextFunction } from 'express';

import type { WorkspaceDependencies, WorkspaceFeatures } from './dependencies.js';
import { createDailyService, requireWorkspaceUser, resolveWorkspaceHandoff, bindWorkspaceHandoff } from './service.js';
import { WorkspaceError } from './store.js';
export function workspaceHandler(fn: (req: Request, res: Response) => unknown) { return (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => fn(req, res)).catch(error => { if (error instanceof WorkspaceError)
    res.status(error.statusCode).json({ error: error.message });
else
    next(error); }); }; }
export function workspaceUserId(req: Request): number { return Number((req as Request & {
    user?: {
        id?: number;
    };
}).user?.id); }
export function createWorkspaceRouter(deps: WorkspaceDependencies, features: WorkspaceFeatures = {}) {
    const router = Router(), daily = createDailyService(deps);
    router.use((req, res, next) => { try {
        requireWorkspaceUser(deps, workspaceUserId(req));
        next();
    }
    catch (error) {
        if (error instanceof WorkspaceError)
            res.status(error.statusCode).json({ error: error.message });
        else
            next(error);
    } });
    router.get('/projects', workspaceHandler((req, res) => res.json(deps.listProjects(workspaceUserId(req)))));
    router.get('/tasks', workspaceHandler((req, res) => res.json(daily.list(workspaceUserId(req)))));
    router.post('/tasks', workspaceHandler((req, res) => res.status(201).json(daily.create(workspaceUserId(req), req.body))));
    router.patch('/tasks/:id', workspaceHandler((req, res) => { const { revision, title, dueAt, priority, completed } = req.body; const patch = Object.fromEntries(Object.entries({ title, dueAt, priority, completed }).filter(([, v]) => v !== undefined)); res.json(daily.update(workspaceUserId(req), String(req.params.id), revision, patch)); }));
    router.get('/priorities', workspaceHandler((req, res) => res.json(daily.priorities(workspaceUserId(req)))));
    router.post('/handoff', workspaceHandler(async (req, res) => res.json(await resolveWorkspaceHandoff(deps, workspaceUserId(req), req.body))));
    router.post('/handoff/:id/bind', workspaceHandler((req, res) => res.json(bindWorkspaceHandoff(deps, workspaceUserId(req), String(req.params.id), req.body.sessionId))));
    for (const name of ['mail', 'documents', 'team'] as const) {
        if (features[name])
            router.use('/' + name, features[name]!);
    }
    return router;
}
