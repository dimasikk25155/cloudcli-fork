/**
 * `workspace_action` `browser.*` — the agent of a chat drives its own page of the Neo3
 * invisible browser (nothing appears on the Mac; the user watches it live in the
 * «Браузер» tab of the canvas). `safari.show` is kept as a synonym of `browser.open`
 * for older instructions. Admin only; refusals are plain texts for the agent.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { safariLiveBindingsDb } from '@/modules/database/index.js';
import { isModActive, modOffError } from '@/shared/mods.js';
import { isAdminUser } from '@/shared/project-access.js';
import { AppError } from '@/shared/utils.js';

import { BrowserError } from './safari-live.browser.js';
import type { SafariBindingsStore } from './safari-live.routes.js';
import { safariLiveService } from './safari-live.runtime.js';
import { chatPageId, normalizePageUrl } from './safari-live.service.js';
import type { BrowserReply, SafariLiveService } from './safari-live.types.js';

export const BROWSER_ACTIONS = [
  'browser.open',
  'browser.click',
  'browser.type',
  'browser.press',
  'browser.scroll',
  'browser.read',
  'browser.eval',
  'browser.wait',
  'browser.screenshot',
  'browser.close',
  'safari.show',
] as const;

export type BrowserActionName = (typeof BROWSER_ACTIONS)[number];

const KEYS = ['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp'];
const DEFAULT_READ_MAX = 20_000;
const MAX_READ = 100_000;
const MAX_SCRIPT = 100_000;

export const BROWSER_AGENT_TEXT = {
  adminOnly: 'Браузер доступен только администратору',
  unsupported: 'Браузер вживую работает только на Mac',
  badUrl: 'Нужен адрес страницы http(s) в data.url',
  noPage: 'Страницы нет — сначала browser.open {data:{url:"<адрес>"}}',
  closeHint: 'Закончишь со страницей — сразу browser.close.',
  opened: (title: string, url: string, loading: boolean) =>
    `Открыта «${title || url}» (${url})${loading ? ', ещё загружается' : ''}. Дима видит страницу справа в Neo3, вкладка «Браузер». `
    + 'Закончишь со страницей — сразу browser.close.',
} as const;

export type SafariLiveActionsOptions = {
  service: SafariLiveService;
  bindings: SafariBindingsStore;
  modOn: (userId: number) => boolean;
  isAdmin: (userId: number) => boolean;
  notify: (userId: number, sessionId: string) => void;
  /** Writes a screenshot, returns its path. Default `~/.cloudcli/browser-shots/<sessionId>/<time>.jpg`. */
  saveShot?: (sessionId: string, jpeg: Buffer) => Promise<string>;
};

const refuse = (message: string, statusCode: number, code: string) => new AppError(message, { code, statusCode });

async function defaultSaveShot(sessionId: string, jpeg: Buffer): Promise<string> {
  const folder = path.join(os.homedir(), '.cloudcli', 'browser-shots', sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || 'chat');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
  await writeFile(file, jpeg);
  return file;
}

/** Helper failure → a refusal the agent can act on. */
function refusalFor(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!(error instanceof BrowserError)) {
    return refuse(`Браузер не ответил: ${error instanceof Error ? error.message : 'ошибка'}. Скажи Диме одной строкой`, 502, 'BROWSER_ERROR');
  }
  switch (error.code) {
    case 'unsupported': return refuse(BROWSER_AGENT_TEXT.unsupported, 409, 'UNSUPPORTED');
    case 'helper_missing': return refuse(`${error.message} — скажи Диме одной строкой`, 503, 'BROWSER_MISSING');
    case 'bad_url': return refuse(BROWSER_AGENT_TEXT.badUrl, 400, 'BAD_URL');
    case 'no_page':
    case 'helper_exit': return refuse(BROWSER_AGENT_TEXT.noPage, 404, 'NO_PAGE');
    case 'no_element': return refuse('Элемент не найден на странице — проверь selector/text через browser.read', 404, 'NO_ELEMENT');
    case 'timeout': return refuse('Не дождался: страница или элемент не появились вовремя', 504, 'TIMEOUT');
    case 'js_error': return refuse(`Ошибка скрипта на странице: ${error.message}`, 400, 'JS_ERROR');
    case 'navigation_failed': return refuse(`Страница не открылась: ${error.message}`, 502, 'NAVIGATION_FAILED');
    case 'bad_args': return refuse(`Неверные данные для браузера: ${error.message}`, 400, 'BAD_REQUEST');
    default: return refuse(`Браузер не ответил (${error.code}). Скажи Диме одной строкой`, 502, 'BROWSER_ERROR');
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const where = (reply: BrowserReply) => ({ url: String(reply.url ?? ''), title: String(reply.title ?? '') });

export function createSafariLiveActions(options: SafariLiveActionsOptions) {
  const { service, bindings, modOn, isAdmin, notify } = options;
  const saveShot = options.saveShot ?? defaultSaveShot;

  /** Page the chat works on: its binding (the user or `safari.show {pageId}` may point it elsewhere), else its own. */
  const pageOf = (sessionId: string) => bindings.get(sessionId)?.pageId ?? chatPageId(sessionId);

  async function open(userId: number, sessionId: string, rawUrl: unknown) {
    const url = normalizePageUrl(rawUrl);
    if (!url) throw refuse(BROWSER_AGENT_TEXT.badUrl, 400, 'BAD_URL');
    const pageId = chatPageId(sessionId);
    const page = await service.openPage(pageId, url);
    bindings.set(sessionId, { pageId, url: page.url, title: page.title, boundBy: 'agent' });
    notify(userId, sessionId);
    return { pageId, url: page.url, title: page.title, loading: page.loading, message: BROWSER_AGENT_TEXT.opened(page.title, page.url, page.loading) };
  }

  /** `safari.show {pageId}` (or the older `windowId`) — show an already open page in this chat. */
  async function bindOpenPage(userId: number, sessionId: string, wanted: string) {
    const list = await service.listWindows();
    const page = list.windows.find((candidate) => candidate.pageId === wanted);
    if (!page) {
      const open = list.windows.map((candidate) => `«${candidate.pageId}»`).join(', ');
      throw refuse(`Страницы ${wanted} нет${open ? ` (открыты: ${open})` : ''} — открой её: browser.open {data:{url:"<адрес>"}}`, 404, 'NO_PAGE');
    }
    bindings.set(sessionId, { pageId: page.pageId, url: page.url, title: page.title, boundBy: 'agent' });
    notify(userId, sessionId);
    return { pageId: page.pageId, url: page.url, title: page.title, loading: false, message: BROWSER_AGENT_TEXT.opened(page.title, page.url, false) };
  }

  async function perform(userId: number, sessionId: string, action: string, data: Record<string, unknown>): Promise<unknown> {
    const pageId = () => pageOf(sessionId);
    switch (action) {
      case 'browser.open':
        return open(userId, sessionId, data.url);

      case 'safari.show': {
        if (data.url !== undefined && data.url !== null && data.url !== '') return open(userId, sessionId, data.url);
        const wanted = text(data.pageId) ?? (data.windowId !== undefined && data.windowId !== null ? String(data.windowId) : undefined);
        return bindOpenPage(userId, sessionId, wanted ?? chatPageId(sessionId));
      }

      case 'browser.click': {
        const args: Record<string, unknown> = {};
        const x = finite(data.x);
        const y = finite(data.y);
        if (x !== undefined && y !== undefined) Object.assign(args, { x, y });
        else if (text(data.selector)) args.selector = data.selector;
        else if (text(data.text)) args.text = data.text;
        else throw refuse('Нужен data.selector, data.text или data.x и data.y', 400, 'BAD_REQUEST');
        const reply = await service.command('click', pageId(), args);
        return { ...where(reply), x: reply.x, y: reply.y };
      }

      case 'browser.type': {
        if (typeof data.text !== 'string' || !data.text) throw refuse('Нужен data.text', 400, 'BAD_REQUEST');
        const args: Record<string, unknown> = { text: data.text };
        if (text(data.selector)) args.selector = data.selector;
        let reply = await service.command('type', pageId(), args);
        if (data.submit === true) reply = await service.command('press', pageId(), { key: 'Enter' });
        // The typed text is not echoed back.
        return { ...where(reply), typed: data.text.length, submitted: data.submit === true };
      }

      case 'browser.press': {
        if (typeof data.key !== 'string' || !KEYS.includes(data.key)) throw refuse(`data.key — одна из клавиш: ${KEYS.join(', ')}`, 400, 'BAD_REQUEST');
        return where(await service.command('press', pageId(), { key: data.key }));
      }

      case 'browser.scroll': {
        const args: Record<string, unknown> = { dy: clamp(finite(data.dy) ?? 600, -20_000, 20_000) };
        const x = finite(data.x);
        const y = finite(data.y);
        if (x !== undefined && y !== undefined) Object.assign(args, { x, y });
        return where(await service.command('scroll', pageId(), args));
      }

      case 'browser.read': {
        const format = data.format === undefined ? 'text' : data.format;
        if (format !== 'text' && format !== 'html' && format !== 'links') throw refuse('data.format — text, html или links', 400, 'BAD_REQUEST');
        const max = Math.round(clamp(finite(data.max) ?? DEFAULT_READ_MAX, 100, MAX_READ));
        const args: Record<string, unknown> = { format, max };
        if (text(data.selector)) args.selector = data.selector;
        const reply = await service.command('read', pageId(), args);
        const result: Record<string, unknown> = { ...where(reply), content: String(reply.content ?? ''), truncated: reply.truncated === true };
        if (reply.truncated === true) result.message = `Обрезано до ${max} символов — сузь data.selector или подними data.max (до ${MAX_READ})`;
        return result;
      }

      case 'browser.eval': {
        if (typeof data.js !== 'string' || !data.js.trim() || data.js.length > MAX_SCRIPT) throw refuse('Нужен data.js — выражение или код JavaScript', 400, 'BAD_REQUEST');
        const reply = await service.command('eval', pageId(), { js: data.js });
        return reply.truncated === true ? { result: reply.result, truncated: true } : { result: reply.result };
      }

      case 'browser.wait': {
        const args: Record<string, unknown> = {};
        if (text(data.selector)) args.selector = data.selector;
        const ms = finite(data.ms);
        if (ms !== undefined) args.ms = Math.round(clamp(ms, 0, 30_000));
        const reply = await service.command('wait', pageId(), args);
        return { ...where(reply), found: reply.found === true || undefined };
      }

      case 'browser.screenshot': {
        const reply = await service.command('snapshot', pageId(), { maxWidth: 1280, quality: 0.8 });
        if (typeof reply.jpeg !== 'string' || !reply.jpeg) throw refuse('Снимок не получился — повтори', 502, 'BROWSER_ERROR');
        const file = await saveShot(sessionId, Buffer.from(reply.jpeg, 'base64'));
        return { path: file, width: reply.width, height: reply.height, message: `Снимок страницы: ${file}` };
      }

      case 'browser.close': {
        const closed = await service.closePage(pageId());
        return {
          ...closed,
          message: closed.unloaded ? 'Страница закрыта, браузер выгружен из памяти' : 'Страница закрыта',
        };
      }

      default:
        throw refuse('Неизвестное действие браузера', 400, 'BAD_REQUEST');
    }
  }

  async function run(userId: number, sessionId: string, action: string, data: Record<string, unknown> = {}): Promise<unknown> {
    if (!isAdmin(userId)) throw refuse(BROWSER_AGENT_TEXT.adminOnly, 403, 'FORBIDDEN');
    if (!modOn(userId)) throw modOffError('modSafariLive');
    try {
      return await perform(userId, sessionId, action, data);
    } catch (error) {
      throw refusalFor(error);
    }
  }

  return { run };
}

const productionActions = createSafariLiveActions({
  service: safariLiveService,
  bindings: safariLiveBindingsDb,
  modOn: (userId) => isModActive(userId, 'modSafariLive'),
  isAdmin: (userId) => isAdminUser({ id: userId }),
  // Lazy: the websocket module is big and imports half the server.
  notify: (userId, sessionId) => {
    void import('@/modules/websocket/index.js')
      .then(({ notifySafariLiveChanged }) => notifySafariLiveChanged(userId, sessionId))
      .catch(() => {});
  },
});

/** Production `browser.*` / `safari.show` used by `workspace_action`. */
export const runBrowserAction = productionActions.run;
