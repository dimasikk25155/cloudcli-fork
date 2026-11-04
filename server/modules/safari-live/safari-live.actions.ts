/**
 * `workspace_action` `safari.show` — the agent of a chat binds its Safari
 * window to the chat: the window moves onto the invisible «Neo3 Safari»
 * display (fully drawn, never in front of Dima) and the «Safari» tab opens
 * on the canvas. Admin only; refusals are plain texts for the agent.
 */

import { safariLiveBindingsDb } from '@/modules/database/index.js';
import { isModActive, modOffError } from '@/shared/mods.js';
import { isAdminUser } from '@/shared/project-access.js';
import { AppError } from '@/shared/utils.js';

import type { SafariBindingsStore } from './safari-live.routes.js';
import { safariLiveService } from './safari-live.runtime.js';
import type { SafariLiveService } from './safari-live.types.js';

export const SAFARI_AGENT_TEXT = {
  adminOnly: 'Safari вживую доступен только администратору',
  noWindows: 'Окон Safari нет — открой страницу: open -a Safari -g "<url>", затем повтори safari.show',
  noPermission: 'Нет разрешения «Запись экрана» — скажи Диме одной строкой',
  unsupported: 'Safari вживую работает только на Mac',
  shown: (title: string) => `Окно «${title}» показано Диме справа в Neo3 вживую (невидимый экран). Safari вперёд не выводи и не прячь.`,
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

export function createSafariLiveActions(options: SafariLiveActionsOptions) {
  const { service, bindings, modOn, isAdmin, notify } = options;

  async function showForAgent(userId: number, sessionId: string, data: Record<string, unknown> = {}): Promise<SafariShowResult> {
    if (!isAdmin(userId)) throw refuse(SAFARI_AGENT_TEXT.adminOnly, 403, 'FORBIDDEN');
    if (!modOn(userId)) throw modOffError('modSafariLive');

    const titleContains = typeof data.titleContains === 'string' ? data.titleContains.trim() : '';
    const { window, list } = await service.pickWindow(titleContains || undefined);
    if (list.state === 'unsupported') throw refuse(SAFARI_AGENT_TEXT.unsupported, 409, 'UNSUPPORTED');
    if (list.state === 'no_permission') throw refuse(SAFARI_AGENT_TEXT.noPermission, 409, 'NO_PERMISSION');
    if (list.state !== 'ok') {
      throw refuse(`Safari вживую недоступен: ${list.message || 'помощник не ответил'}. Скажи Диме одной строкой`, 503, 'SAFARI_LIVE_ERROR');
    }
    if (!window) {
      if (titleContains && list.windows.length > 0) {
        const titles = list.windows.map((candidate) => `«${candidate.title}»`).join(', ');
        throw refuse(`Окна Safari с «${titleContains}» в заголовке нет. Открытые окна: ${titles}`, 404, 'WINDOW_NOT_FOUND');
      }
      throw refuse(SAFARI_AGENT_TEXT.noWindows, 404, 'NO_WINDOWS');
    }

    const shown = await service.ensureDisplay();
    if (!shown.ok) {
      bindings.set(sessionId, { windowId: window.windowId, title: window.title, boundBy: 'agent' });
      notify(userId, sessionId);
      throw refuse(
        `Окно «${window.title}» привязано к чату, но невидимый экран не создан (${shown.message}) — картинка может быть пустой. Safari вперёд не выводи; скажи Диме одной строкой`,
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
        `Окно «${window.title}» привязано к чату, но не перенесено на невидимый экран (${placed.message || 'ошибка'}) — картинка может быть пустой. Safari вперёд не выводи; скажи Диме одной строкой`,
        502,
        'PLACE_FAILED',
      );
    }
    return { windowId: window.windowId, title: window.title, message: SAFARI_AGENT_TEXT.shown(window.title) };
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
