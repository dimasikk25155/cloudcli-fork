/**
 * `workspace_action` `safari.show` — the agent of a chat shows its Safari window:
 * `{url}` opens the page in the agent's OWN new window (never Dima's front window),
 * `{windowId, url}` navigates that window, `{windowId}` / `{titleContains}` bind an open one.
 * The window moves onto the invisible «Neo3 Safari» display (fully drawn, never in front of
 * Dima) and the «Safari» tab opens on the canvas. Admin only; refusals are plain texts for the agent.
 */

import { safariLiveBindingsDb } from '@/modules/database/index.js';
import { isModActive, modOffError } from '@/shared/mods.js';
import { isAdminUser } from '@/shared/project-access.js';
import { AppError } from '@/shared/utils.js';

import type { SafariBindingsStore } from './safari-live.routes.js';
import { safariLiveService } from './safari-live.runtime.js';
import { isTitledWindow, normalizePageUrl } from './safari-live.service.js';
import type { EnsureDisplayResult, OpenWindowResult, SafariLiveService, SafariWindow, SafariWindowList } from './safari-live.types.js';

export const SAFARI_AGENT_TEXT = {
  adminOnly: 'Safari вживую доступен только администратору',
  noWindows: 'Окон Safari нет — открой страницу в своём окне: safari.show {data:{url:"<адрес>"}} (не open -a Safari: он кладёт страницу в окно Димы)',
  noPermission: 'Нет разрешения «Запись экрана» — скажи Диме одной строкой',
  unsupported: 'Safari вживую работает только на Mac',
  badUrl: 'Нужен адрес страницы http(s) в data.url',
  badWindowId: 'windowId — номер окна Safari (целое число из ответа safari.show)',
  shown: (title: string, windowId: number) =>
    `Окно «${title}» (windowId ${windowId}) показано Диме справа в Neo3 вживую (невидимый экран). `
    + `Следующую страницу открывай в нём же: safari.show {data:{windowId:${windowId}, url:"<адрес>"}}. Safari вперёд не выводи и не прячь.`,
} as const;

export type SafariShowResult = { windowId: number; title: string; message: string };

export type SafariLiveActionsOptions = {
  service: SafariLiveService;
  bindings: SafariBindingsStore;
  modOn: (userId: number) => boolean;
  isAdmin: (userId: number) => boolean;
  notify: (userId: number, sessionId: string) => void;
};

const refuse = (message: string, statusCode: number, code: string) => new AppError(message, { code, statusCode });

function unavailable(message: string | undefined): AppError {
  return refuse(`Safari вживую недоступен: ${message || 'помощник не ответил'}. Скажи Диме одной строкой`, 503, 'SAFARI_LIVE_ERROR');
}

/** A list the agent can pick from, else the refusal text for it. */
function assertListUsable(list: SafariWindowList): void {
  if (list.state === 'unsupported') throw refuse(SAFARI_AGENT_TEXT.unsupported, 409, 'UNSUPPORTED');
  if (list.state === 'no_permission') throw refuse(SAFARI_AGENT_TEXT.noPermission, 409, 'NO_PERMISSION');
  if (list.state !== 'ok') throw unavailable(list.message);
}

function openRefusal(opened: Exclude<OpenWindowResult, { ok: true }>, windowId?: number): AppError {
  if (opened.state === 'unsupported') return refuse(SAFARI_AGENT_TEXT.unsupported, 409, 'UNSUPPORTED');
  if (opened.state === 'no_permission') return refuse(SAFARI_AGENT_TEXT.noPermission, 409, 'NO_PERMISSION');
  if (opened.end === 'window_gone') {
    return refuse(`Окно Safari ${windowId ?? ''} закрылось — открой страницу в новом окне: safari.show {data:{url:"<адрес>"}}`, 404, 'WINDOW_GONE');
  }
  return unavailable(opened.message);
}

function readWindowIdInput(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const windowId = Number(raw);
  if (!Number.isSafeInteger(windowId) || windowId <= 0) throw refuse(SAFARI_AGENT_TEXT.badWindowId, 400, 'BAD_REQUEST');
  return windowId;
}

export function createSafariLiveActions(options: SafariLiveActionsOptions) {
  const { service, bindings, modOn, isAdmin, notify } = options;

  /**
   * Which window to show: `url` alone → a NEW window of the agent (never Dima's front window);
   * `windowId` (+ `url` → navigate it) → that window; else the newest titled window,
   * or the newest whose title contains `titleContains`.
   */
  async function resolveTarget(data: Record<string, unknown>): Promise<{ target: SafariWindow; shown: EnsureDisplayResult | null }> {
    const url = data.url === undefined || data.url === null || data.url === '' ? undefined : normalizePageUrl(data.url);
    if (url === null) throw refuse(SAFARI_AGENT_TEXT.badUrl, 400, 'BAD_URL');
    const windowId = readWindowIdInput(data.windowId);

    if (url && windowId === undefined) {
      // The display first: the new window then spends no time on Dima's screen.
      const shown = await service.ensureDisplay();
      const opened = await service.openWindow(url);
      if (!opened.ok) throw openRefusal(opened);
      return { target: { windowId: opened.windowId, title: url, onScreen: false, width: 0, height: 0 }, shown };
    }
    if (windowId !== undefined) {
      if (url) {
        const opened = await service.openWindow(url, windowId);
        if (!opened.ok) throw openRefusal(opened, windowId);
      }
      const list = await service.listWindows();
      assertListUsable(list);
      const found = list.windows.find((candidate) => candidate.windowId === windowId);
      if (!found) {
        throw refuse(`Окна Safari с windowId ${windowId} нет — открой страницу в новом окне: safari.show {data:{url:"<адрес>"}}`, 404, 'WINDOW_NOT_FOUND');
      }
      return { target: { ...found, title: found.title.trim() || url || found.title }, shown: null };
    }

    const titleContains = typeof data.titleContains === 'string' ? data.titleContains.trim() : '';
    const { window, list } = await service.pickWindow(titleContains || undefined);
    assertListUsable(list);
    if (!window) {
      const titled = list.windows.filter(isTitledWindow);
      if (titleContains && titled.length > 0) {
        const titles = titled.map((candidate) => `«${candidate.title}»`).join(', ');
        throw refuse(`Окна Safari с «${titleContains}» в заголовке нет. Открытые окна: ${titles}`, 404, 'WINDOW_NOT_FOUND');
      }
      throw refuse(SAFARI_AGENT_TEXT.noWindows, 404, 'NO_WINDOWS');
    }
    return { target: window, shown: null };
  }

  async function showForAgent(userId: number, sessionId: string, data: Record<string, unknown> = {}): Promise<SafariShowResult> {
    if (!isAdmin(userId)) throw refuse(SAFARI_AGENT_TEXT.adminOnly, 403, 'FORBIDDEN');
    if (!modOn(userId)) throw modOffError('modSafariLive');

    const resolved = await resolveTarget(data);
    const window = resolved.target;
    const shown = resolved.shown ?? await service.ensureDisplay();
    if (!shown.ok) {
      bindings.set(sessionId, { windowId: window.windowId, title: window.title, boundBy: 'agent' });
      notify(userId, sessionId);
      throw refuse(
        `Окно «${window.title}» (windowId ${window.windowId}) привязано к чату, но невидимый экран не создан (${shown.message}) — картинка может быть пустой. Safari вперёд не выводи; скажи Диме одной строкой`,
        502,
        'DISPLAY_FAILED',
      );
    }
    const placed = await service.placeOnDisplay(window.windowId);
    if (!placed.ok && placed.end === 'window_gone') {
      throw refuse(`Окно Safari «${window.title}» закрылось, пока его переносили — открой страницу заново и повтори safari.show`, 404, 'WINDOW_GONE');
    }
    bindings.set(sessionId, { windowId: window.windowId, title: window.title, boundBy: 'agent' });
    notify(userId, sessionId);
    if (!placed.ok) {
      throw refuse(
        `Окно «${window.title}» (windowId ${window.windowId}) привязано к чату, но не перенесено на невидимый экран (${placed.message || 'ошибка'}) — картинка может быть пустой. Safari вперёд не выводи; скажи Диме одной строкой`,
        502,
        'PLACE_FAILED',
      );
    }
    return { windowId: window.windowId, title: window.title, message: SAFARI_AGENT_TEXT.shown(window.title, window.windowId) };
  }

  return { showForAgent };
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

/** Production `safari.show` used by `workspace_action`. */
export const showForAgent = productionActions.showForAgent;
