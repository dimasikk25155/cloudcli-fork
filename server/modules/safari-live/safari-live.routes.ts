import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { modOffError } from '@/shared/mods.js';
import { requireSessionAccess } from '@/shared/require-session-access.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { BrowserError } from './safari-live.browser.js';
import { PAGE_HEIGHT, PAGE_WIDTH } from './safari-live.service.js';
import { signStreamToken } from './safari-live.stream.js';
import type { BrowserInput, SafariBinding, SafariLiveService, SafariLiveView, SafariWindowList } from './safari-live.types.js';

export type SafariBindingsStore = {
  get(sessionId: string): SafariBinding | null;
  set(sessionId: string, input: { pageId: string; url: string; title: string; boundBy: 'agent' | 'user' }): SafariBinding;
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
 * What the «Браузер» tab shows for a chat. The stream link is issued when the bound
 * page is open, or when it can be reopened (`unloaded`: the page is gone but its last
 * address is known — subscribing opens it again).
 */
export function buildSafariLiveView(userId: number, binding: SafariBinding | null, list: SafariWindowList): SafariLiveView {
  const live = binding ? list.windows.find((page) => page.pageId === binding.pageId) : undefined;
  const windowAlive = Boolean(live);
  const state = list.state === 'ok' && binding && !live && binding.url ? 'unloaded' : list.state;
  const fresh = binding && live && (live.title !== binding.title || (live.url && live.url !== binding.url))
    ? { ...binding, title: live.title || binding.title, url: live.url || binding.url }
    : binding;
  const view: SafariLiveView = {
    state,
    binding: fresh,
    windowAlive,
    streamUrl: binding && ((state === 'ok' && windowAlive) || state === 'unloaded')
      ? `/sl/${signStreamToken({ userId, pageId: binding.pageId, sessionId: binding.sessionId })}/stream`
      : null,
    windows: list.windows,
  };
  if (list.message) view.message = list.message;
  return view;
}

const INPUT_KINDS = new Set(['click', 'move', 'down', 'up', 'scroll', 'key', 'text']);
const INPUT_KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp']);
const MAX_INPUT_TEXT = 2_000;

const badInput = () => new AppError('Неверный ввод для браузера', { code: 'BAD_REQUEST', statusCode: 400 });

function coordinate(raw: unknown, max: number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = Number(raw);
  if (typeof raw !== 'number' || !Number.isFinite(value)) throw badInput();
  return Math.min(Math.max(value, 0), max);
}

/** The user's input in page pixels; its content never goes to a message or a log. */
export function readBrowserInput(body: unknown): BrowserInput {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const kind = String(raw.kind ?? '');
  if (!INPUT_KINDS.has(kind)) throw badInput();
  const input: BrowserInput = { kind: kind as BrowserInput['kind'] };
  const x = coordinate(raw.x, PAGE_WIDTH);
  const y = coordinate(raw.y, PAGE_HEIGHT);
  if (x !== undefined) input.x = x;
  if (y !== undefined) input.y = y;
  if (kind === 'click' || kind === 'move' || kind === 'down' || kind === 'up') {
    if (x === undefined || y === undefined) throw badInput();
  }
  if (kind === 'scroll') {
    if (typeof raw.dy !== 'number' || !Number.isFinite(raw.dy)) throw badInput();
    input.dy = Math.min(Math.max(raw.dy, -10_000), 10_000);
  }
  if (kind === 'key') {
    if (typeof raw.key !== 'string' || !INPUT_KEYS.has(raw.key)) throw badInput();
    input.key = raw.key;
  }
  if (kind === 'text') {
    if (typeof raw.text !== 'string' || !raw.text || raw.text.length > MAX_INPUT_TEXT) throw badInput();
    input.text = raw.text;
  }
  return input;
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
      const pageId = req.body?.pageId;
      if (typeof pageId !== 'string' || !pageId.trim() || pageId.length > 200) {
        throw new AppError('Нужен pageId страницы браузера', { code: 'BAD_REQUEST', statusCode: 400 });
      }
      const list = await service.listWindows();
      if (list.state !== 'ok') {
        // Nothing to bind to while the browser cannot list pages; the tab shows the state.
        res.json(createApiSuccessResponse(buildSafariLiveView(userId, bindings.get(sessionId), list)));
        return;
      }
      const page = list.windows.find((candidate) => candidate.pageId === pageId);
      if (!page) {
        throw new AppError('Страница закрыта — выбери другую', { code: 'PAGE_GONE', statusCode: 404 });
      }
      const binding = bindings.set(sessionId, { pageId, url: page.url, title: page.title, boundBy: 'user' });
      notify(userId, sessionId);
      res.json(createApiSuccessResponse(buildSafariLiveView(userId, binding, list)));
    }),
  );

  // «Управлять»: the user's clicks, wheel and keys go to the chat's page. The body is never logged.
  router.post(
    '/sessions/:sessionId/input',
    sessionAccess,
    asyncHandler(async (req, res) => {
      const sessionId = String(req.params.sessionId);
      const input = readBrowserInput(req.body);
      const binding = bindings.get(sessionId);
      if (!binding) throw new AppError('У чата нет страницы браузера', { code: 'NO_PAGE', statusCode: 404 });
      try {
        await service.input(binding.pageId, input);
      } catch (error) {
        if (error instanceof BrowserError && (error.code === 'no_page' || error.code === 'helper_exit')) {
          throw new AppError('Страница закрыта — браузер откроет её снова', { code: 'PAGE_GONE', statusCode: 404 });
        }
        if (error instanceof BrowserError && error.code === 'bad_args') throw badInput();
        throw new AppError('Браузер не принял ввод', { code: 'BROWSER_ERROR', statusCode: 502 });
      }
      res.status(204).end();
    }),
  );

  return router;
}
