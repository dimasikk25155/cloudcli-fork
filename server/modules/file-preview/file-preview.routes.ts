import express from 'express';
import type { Request, Response } from 'express';
import mime from 'mime-types';

import { projectsDb } from '@/modules/database/index.js';
import { canAccessProject, isAdminUser } from '@/shared/project-access.js';

import { createFilePreviewService, PreviewError } from './file-preview.service.js';

type User = { id: number; role?: string };
type Dependencies = {
  service?: ReturnType<typeof createFilePreviewService>;
  projectRoot?: (id: string) => Promise<string | null>;
  access?: (user: User, projectId: string) => boolean;
  admin?: (user: User) => boolean;
  resolve: (options: { filePath: string; projectRoot: string; user: User; allowSearch: boolean }) => Promise<{ ok: true; resolved: string } | { ok: false; status: number; error: string }>;
};
const fail = (res: Response, error: unknown) => {
  const status = error instanceof PreviewError ? error.status : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500;
  res.status(status).type('text/plain').send(error instanceof PreviewError ? error.message : status === 404 ? 'Файл не найден' : 'Не удалось открыть превью');
};

export function createFilePreviewRoutes(deps: Dependencies) {
  const access = deps.access ?? canAccessProject;
  const service = deps.service ?? createFilePreviewService({ canAccess: (userId, projectId) => access({ id: userId }, projectId) });
  const create = express.Router({ mergeParams: true });
  create.post('/', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const projectId = String(req.params.projectId);
      const user = (req as Request & { user: User }).user;
      if (!user || !access(user, projectId)) throw new PreviewError(403, 'Нет доступа к проекту');
      if (typeof req.body?.path !== 'string' || !req.body.path) throw new PreviewError(400, 'Не указан файл');
      const projectRoot = await (deps.projectRoot ?? projectsDb.getProjectPathById)(projectId);
      if (!projectRoot) throw new PreviewError(404, 'Проект не найден');
      const admin = (deps.admin ?? isAdminUser)(user);
      const outcome = await deps.resolve({ filePath: req.body.path, projectRoot, user: { ...user, role: admin ? 'admin' : 'user' }, allowSearch: true });
      if (!outcome.ok) throw new PreviewError(outcome.status, outcome.error);
      res.json(await service.issue({ file: outcome.resolved, projectRoot, projectId, userId: user.id, admin }));
    } catch (error) { fail(res, error); }
  });
  const assets = express.Router();
  assets.get<{ token: string; 0: string }>('/:token/*', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' });
    // Opaque origin even when opened directly, rather than only in an iframe.
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src blob: https: http:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    try {
      const file = await service.resource(req.params.token, req.params[0]);
      res.type(mime.lookup(file) || 'application/octet-stream');
      // Stream assets without buffering large media. The URL preserves CSS and module resolution.
      res.sendFile(file, { cacheControl: false, dotfiles: 'deny' }, (error) => {
        if (error && !res.headersSent) fail(res, error);
      });
    } catch (error) { fail(res, error); }
  });
  return { create, assets };
}
