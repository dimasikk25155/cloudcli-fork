import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { modOffError } from '@/shared/mods.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { signStreamToken } from './safari-live.stream.js';
import type { SafariBinding, SafariLiveService, SafariLiveView, SafariWindowList } from './safari-live.types.js';

export type SafariBindingsStore = {
  get(sessionId: string): SafariBinding | null;
  set(sessionId: string, input: { windowId: number; title: string; boundBy: 'agent' | 'user' }): SafariBinding;
  clear(sessionId: string): void;
};

export type SafariLiveRouterOptions = {
  service: SafariLiveService;
  bindings: SafariBindingsStore;
  modOn: (userId: unknown) => boolean;
  notify: (userId: number, sessionId: string) => void;
  /** Default `requireSessionAccess` (404 unknown chat, 403 foreign chat). */
  sessionAccess?: RequestHandler;
};

type AuthedRequest = Request & { user?: { id?: unknown } };

function userIdOf(req: Request): number {
  return Number((req as AuthedRequest).user?.id);
}

/**
 * What the «Safari» tab shows for a chat. The stream link is issued only
 * when the helper works and the bound window still exists.
 */
export function buildSafariLiveView(userId: number, binding: SafariBinding | null, list: SafariWindowList): SafariLiveView {
  const live = binding ? list.windows.find((window) => window.windowId === binding.windowId) : undefined;
  const windowAlive = Boolean(live);
  const view: SafariLiveView = {
    state: list.state,
    binding: binding && live && live.title && live.title !== binding.title ? { ...binding, title: live.title } : binding,
    windowAlive,
    streamUrl: list.state === 'ok' && binding && windowAlive
      ? `/sl/${signStreamToken({ userId, windowId: binding.windowId, sessionId: binding.sessionId })}/stream`
      : null,
    windows: list.windows,
  };
  if (list.message) view.message = list.message;
  return view;
}

/**
 * `/api/safari-live` — mounted behind authenticateToken + requireAdmin.
 * Mod off → 409 MOD_OFF for every request.
 */
export function createSafariLiveRouter(options: SafariLiveRouterOptions) {
  const { service, bindings, modOn, notify } = options;
  const sessionAccess = options.sessionAccess ?? requireSessionAccess;
  const router = express.Router();

  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!modOn((req as AuthedRequest).user?.id)) {
      next(modOffError('modSafariLive'));
      return;
    }
    next();
  });

  router.get(
    '/windows',
    asyncHandler(async (_req, res) => {
      res.json(createApiSuccessResponse(await service.listWindows()));
    }),
  );

  router.get(
    '/sessions/:sessionId',
    sessionAccess,
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params.sessionId);
      const list = await service.listWindows();
      res.json(createApiSuccessResponse(buildSafariLiveView(userIdOf(req), bindings.get(sessionId), list)));
    }),
  );

  router.put(
    '/sessions/:sessionId',
    sessionAccess,
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params.sessionId);
      const userId = userIdOf(req);
      const windowId = Number(req.body?.windowId);
      if (!Number.isSafeInteger(windowId) || windowId <= 0) {
        throw new AppError('Нужен windowId окна Safari', { code: 'BAD_REQUEST', statusCode: 400 });
      }
      const list = await service.listWindows();
      if (list.state !== 'ok') {
        // Nothing to bind to while the helper cannot see windows; the tab shows the state.
        res.json(createApiSuccessResponse(buildSafariLiveView(userId, bindings.get(sessionId), list)));
        return;
      }
      const window = list.windows.find((candidate) => candidate.windowId === windowId);
      if (!window) {
        throw new AppError('Окно Safari закрыто — выбери другое', { code: 'WINDOW_GONE', statusCode: 404 });
      }
      const shown = await service.ensureDisplay();
      const placed = shown.ok ? await service.placeOnDisplay(windowId) : { ok: false, message: shown.message };
      const binding = bindings.set(sessionId, { windowId, title: window.title, boundBy: 'user' });
      notify(userId, sessionId);
      const view = buildSafariLiveView(userId, binding, list);
      if (!placed.ok && placed.message) view.message = placed.message;
      res.json(createApiSuccessResponse(view));
    }),
  );

  return router;
}
