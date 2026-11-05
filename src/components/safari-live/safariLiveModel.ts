/**
 * «Браузер вживую»: чистая логика вкладки — какое состояние показать, как
 * называется привязка и когда вкладка сама встаёт справа. Без React.
 */
import type { SafariLiveView, SafariWindow } from '../../types/app';

export type SafariPanelState =
  | 'live'
  | 'paused'
  | 'window_gone'
  | 'unloaded'
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
  window_gone: 'Страница закрыта — выбери другую',
  unloaded: 'Браузер выгружен — открою последнюю страницу',
  no_windows: 'Страниц нет — агент ещё ничего не открывал',
  no_permission:
    'Нужно разрешение: Системные настройки → Конфиденциальность и безопасность → Запись экрана → включить для node',
  mod_off: 'Мод выключен',
  unsupported: 'Только на Mac',
  error: 'Связь с картинкой прервалась',
  loading: 'Загрузка…',
  pick: 'Выбери страницу в списке',
};

/** Заголовок вкладки холста (в интерфейсе слова Safari нет). */
export const BROWSER_TAB_TITLE = 'Браузер';

/** Как страница называется в списке: заголовок, а пока его нет — адрес. */
export function browserPageLabel(page: Pick<SafariWindow, 'pageId' | 'title' | 'url'>): string {
  return page.title.trim() || page.url || page.pageId;
}

export function panelStateFor(
  view: SafariLiveView | null,
  opts: { isActive: boolean; modOn: boolean; streamBroken?: boolean; reconnecting?: boolean },
): SafariPanelState {
  if (!opts.modOn) return 'mod_off';
  if (!view) return 'loading';
  if (view.state === 'unsupported') return 'unsupported';
  if (view.state === 'no_permission') return 'no_permission';
  if (view.state === 'error') return 'error';
  if (!view.binding) return view.windows.length === 0 ? 'no_windows' : 'pick';
  // Браузер выгружен, привязка есть: подписка на поток сама поднимет последнюю страницу.
  const reopening = view.state === 'unloaded' && view.streamUrl !== null;
  if (!view.windowAlive && !reopening) return 'window_gone';
  if (opts.streamBroken) return 'error';
  if (!opts.isActive) return 'paused';
  if (opts.reconnecting) return 'loading';
  if (reopening) return 'unloaded';
  return view.streamUrl ? 'live' : 'loading';
}

/** Обрыв потока → через столько мс одна переподписка (новый GET → новая ссылка). */
export const STREAM_RESUBSCRIBE_MS = 2000;
/** Переподписанный поток, проживший столько без обрыва, считается восстановленным, даже если браузер не прислал `load`. */
export const STREAM_STABLE_MS = 10_000;

/**
 * Переподписка картинки (R12i): обрыв → `waiting` (2 с) → `retried`; новая картинка
 * (`recovered`) возвращает `ok`, и следующий обрыв снова получает свою переподписку;
 * второй обрыв без восстановления → `broken` («Связь прервалась» + «Повторить»).
 */
export type StreamRecovery = { phase: 'ok' | 'waiting' | 'retried' | 'broken'; since: number };
export type StreamRecoveryEvent = 'break' | 'resubscribed' | 'recovered' | 'reset';
export const STREAM_RECOVERY_START: StreamRecovery = { phase: 'ok', since: 0 };

export function nextStreamRecovery(state: StreamRecovery, event: StreamRecoveryEvent, now: number): StreamRecovery {
  switch (event) {
    case 'reset':
      return { phase: 'ok', since: now };
    case 'resubscribed':
      return state.phase === 'waiting' ? { phase: 'retried', since: now } : state;
    case 'recovered':
      return state.phase === 'retried' ? { phase: 'ok', since: now } : state;
    case 'break':
      if (state.phase === 'ok') return { phase: 'waiting', since: now };
      if (state.phase === 'retried') {
        return now - state.since >= STREAM_STABLE_MS ? { phase: 'waiting', since: now } : { phase: 'broken', since: now };
      }
      return state;
    default:
      return state;
  }
}

/**
 * Ссылка на картинку сменилась. Сервер шлёт `safari_live_changed`, когда поток кончился сам
 * (страница закрыта, сбой помощника), — вкладка перечитывает вид и получает новую ссылку на ту же
 * привязку: это обрыв. Своя переподписка или «Повторить» (`expected`) — не обрыв; другая
 * привязка — начать заново; ссылки нет (страница закрыта) — вкладка просто покажет состояние.
 * Тот же кадр приходит, когда выгруженная страница вернулась (`reopening` → живая) — это не
 * обрыв, а «Вживую».
 */
export function streamUrlEvent(
  prev: { url: string | null; bindingKey: string | null; reopening?: boolean } | null,
  next: { url: string | null; bindingKey: string | null; reopening?: boolean },
  expected: boolean,
): StreamRecoveryEvent | null {
  if (!prev) return null;
  if (prev.bindingKey !== next.bindingKey) return 'reset';
  if (!prev.url || !next.url || prev.url === next.url || expected) return null;
  if (prev.reopening && !next.reopening) return null;
  return 'break';
}

/** Новая привязка (другое окно или новое время) — новый ключ, и вкладка может открыться снова. */
export function safariBindingKey(sessionId: string, binding: { pageId: string; updatedAt: string }): string {
  return `${sessionId}::${binding.pageId}::${binding.updatedAt}`;
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

// ---- Ввод Димы в режиме «Управлять» ----

/** Размер страницы в невидимом браузере — в этих пикселях помощник принимает координаты. */
export const BROWSER_PAGE_WIDTH = 1280;
export const BROWSER_PAGE_HEIGHT = 800;
/** `move` уходит не чаще ~20 раз в секунду. */
export const MOVE_MIN_INTERVAL_MS = 50;

type Size = { width: number; height: number };
type Point = { x: number; y: number };

/**
 * Точка указателя в CSS-пикселях блока `<img>` (`object-contain object-top`) → пиксели страницы
 * 1280×800. Кадр вписан в блок с сохранением пропорций, по горизонтали по центру, по вертикали
 * у верха; вне нарисованного кадра (поля) — `null`, а с `clamp` точка прижимается к краю кадра
 * (нужно, чтобы отпустить кнопку за границей при перетаскивании).
 */
export function pointerToPagePoint(
  point: Point,
  box: Size,
  natural: Size,
  options: { clamp?: boolean } = {},
): Point | null {
  if (!(box.width > 0 && box.height > 0 && natural.width > 0 && natural.height > 0)) return null;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const drawnWidth = natural.width * scale;
  const drawnHeight = natural.height * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  let localX = point.x - offsetX;
  let localY = point.y;
  const outside = localX < 0 || localY < 0 || localX > drawnWidth || localY > drawnHeight;
  if (outside) {
    if (!options.clamp) return null;
    localX = Math.min(Math.max(localX, 0), drawnWidth);
    localY = Math.min(Math.max(localY, 0), drawnHeight);
  }
  return {
    x: Math.round((localX / drawnWidth) * BROWSER_PAGE_WIDTH),
    y: Math.round((localY / drawnHeight) * BROWSER_PAGE_HEIGHT),
  };
}

export type BrowserKeyInput = { kind: 'key'; key: string } | { kind: 'text'; text: string };

const SPECIAL_KEYS = new Set([
  'Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
]);

/**
 * Клавиша → ввод для помощника: служебные — `key`, печатный символ — `text`. Сочетания с Ctrl/Cmd/Alt
 * и прочие клавиши (Shift, F-ряд, Dead) не отправляются — `null`, и Neo3 их не перехватывает.
 */
export function keyboardEventToInput(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): BrowserKeyInput | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (SPECIAL_KEYS.has(event.key)) return { kind: 'key', key: event.key };
  if (event.key.length > 0 && Array.from(event.key).length === 1) return { kind: 'text', text: event.key };
  return null;
}

const MAX_SCROLL_DY = 2000;

/** Колесо → смещение в пикселях (`deltaMode` 0 — пиксели, 1 — строки, 2 — страницы). */
export function wheelToScrollDy(deltaY: number, deltaMode: number): number {
  const factor = deltaMode === 1 ? 16 : deltaMode === 2 ? BROWSER_PAGE_HEIGHT : 1;
  const dy = Math.round(deltaY * factor);
  return Math.max(-MAX_SCROLL_DY, Math.min(MAX_SCROLL_DY, dy)) || 0;
}

/** В страницу уходит только левая кнопка (касание и перо — тоже 0); правая и средняя — нет. */
export function isPrimaryPointerButton(button: number): boolean {
  return button === 0;
}

/**
 * Касание сорвалось (`pointercancel`, потерян захват) при нажатой кнопке — отпустить её в последней
 * известной точке, иначе страница думает, что кнопка зажата, и каждое движение тащит выделение.
 */
export function pointerReleaseInput(
  pressed: boolean,
  lastPoint: Point | null,
): { kind: 'up'; x: number; y: number } | null {
  return pressed && lastPoint ? { kind: 'up', x: lastPoint.x, y: lastPoint.y } : null;
}

export function shouldSendMove(lastSentAt: number | null, now: number): boolean {
  return lastSentAt === null || now - lastSentAt >= MOVE_MIN_INTERVAL_MS;
}
