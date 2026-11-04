/**
 * «Safari вживую»: чистая логика вкладки — какое состояние показать, как
 * называется привязка и когда вкладка сама встаёт справа. Без React.
 */
import type { SafariLiveView, SafariWindow } from '../../types/app';

export type SafariPanelState =
  | 'live'
  | 'paused'
  | 'window_gone'
  | 'no_windows'
  | 'no_permission'
  | 'mod_off'
  | 'unsupported'
  | 'error'
  | 'loading'
  | 'pick';

export const SAFARI_STATE_TEXT: Record<SafariPanelState, string> = {
  live: 'Вживую',
  paused: 'Пауза — вкладка не на виду',
  window_gone: 'Окно закрыто — выбери другое',
  no_windows: 'Окон Safari нет — агент ещё не открывал страницу',
  no_permission:
    'Нужно разрешение: Системные настройки → Конфиденциальность и безопасность → Запись экрана → включить для node',
  mod_off: 'Мод выключен',
  unsupported: 'Только на Mac',
  error: 'Связь с картинкой прервалась',
  loading: 'Загрузка…',
  pick: 'Выбери окно Safari в списке',
};

/** Служебное окно Safari (500×500) приходит без заголовка — в списке его не показываем. */
export function visibleSafariWindows<T extends Pick<SafariWindow, 'title'>>(windows: T[]): T[] {
  return windows.filter((window) => window.title.trim() !== '');
}

export function panelStateFor(
  view: SafariLiveView | null,
  opts: { isActive: boolean; modOn: boolean; streamBroken?: boolean },
): SafariPanelState {
  if (!opts.modOn) return 'mod_off';
  if (!view) return 'loading';
  if (view.state === 'unsupported') return 'unsupported';
  if (view.state === 'no_permission') return 'no_permission';
  if (view.state === 'error') return 'error';
  if (!view.binding) return visibleSafariWindows(view.windows).length === 0 ? 'no_windows' : 'pick';
  if (!view.windowAlive) return 'window_gone';
  if (opts.streamBroken) return 'error';
  if (!opts.isActive) return 'paused';
  return view.streamUrl ? 'live' : 'loading';
}

/** Новая привязка (другое окно или новое время) — новый ключ, и вкладка может открыться снова. */
export function safariBindingKey(sessionId: string, binding: { windowId: number; updatedAt: string }): string {
  return `${sessionId}::${binding.windowId}::${binding.updatedAt}`;
}

export function shouldAutoOpenSafari(args: {
  isMobile: boolean;
  workbenchOn: boolean;
  modOn: boolean;
  isAdmin: boolean;
  bindingKey: string | null;
  alreadyOpened: boolean;
}): boolean {
  return (
    !args.isMobile && args.workbenchOn && args.modOn && args.isAdmin && args.bindingKey !== null && !args.alreadyOpened
  );
}

const STORAGE_KEY = 'neo3.safariLive.autoOpened';
const MAX_REMEMBERED = 50;

type AutoOpenStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function browserStorage(): AutoOpenStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readOpened(storage: AutoOpenStorage | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function wasSafariAutoOpened(key: string, storage: AutoOpenStorage | null = browserStorage()): boolean {
  return readOpened(storage).includes(key);
}

export function markSafariAutoOpened(key: string, storage: AutoOpenStorage | null = browserStorage()): void {
  if (!storage) return;
  const next = [...readOpened(storage).filter((item) => item !== key), key].slice(-MAX_REMEMBERED);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Хранилище недоступно — в худшем случае вкладка откроется ещё раз.
  }
}
