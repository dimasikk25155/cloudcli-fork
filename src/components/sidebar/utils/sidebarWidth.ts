/**
 * Ширина левой панели на компьютере: тянется мышкой за правый край.
 * Живёт на устройстве (`localStorage`), как порядок проектов и чатов.
 * На телефоне не используется — там шторка своей ширины.
 */

export const SIDEBAR_WIDTH_STORAGE_KEY = 'neo3-sidebar-width';

/** Прежняя фиксированная ширина (`md:w-72`). */
export const SIDEBAR_DEFAULT_WIDTH = 288;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 560;

/** Сколько ширины окна оставить чату, как бы широко ни тянули панель. */
export const SIDEBAR_MIN_CHAT_WIDTH = 480;

/** Шаг стрелками на ручке (клавиатура), Shift — крупный шаг. */
export const SIDEBAR_KEY_STEP = 16;
export const SIDEBAR_KEY_STEP_LARGE = 64;

/** Верхняя граница с учётом окна: чату остаётся хотя бы SIDEBAR_MIN_CHAT_WIDTH. */
export const sidebarMaxWidthFor = (viewportWidth?: number): number => {
  if (!viewportWidth || !Number.isFinite(viewportWidth)) return SIDEBAR_MAX_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - SIDEBAR_MIN_CHAT_WIDTH));
};

export const clampSidebarWidth = (width: number, viewportWidth?: number): number => {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  const max = sidebarMaxWidthFor(viewportWidth);
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, width)));
};

/** Сохранённое значение → ширина; мусор и отсутствие → прежние 288. */
export const parseStoredSidebarWidth = (raw: string | null | undefined): number => {
  if (raw == null || raw.trim() === '') return SIDEBAR_DEFAULT_WIDTH;
  const value = Number(raw);
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(value);
};

export const readSidebarWidth = (): number => {
  try {
    return parseStoredSidebarWidth(globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
};

export const writeSidebarWidth = (width: number): void => {
  try {
    if (width === SIDEBAR_DEFAULT_WIDTH) {
      globalThis.localStorage?.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    }
  } catch {
    // Приватный режим/квота: ширина просто не запомнится, панель работает.
  }
};

/** Ширина после нажатия клавиши на ручке; `null` — клавиша не наша. */
export const sidebarWidthForKey = (
  key: string,
  width: number,
  shiftKey: boolean,
  viewportWidth?: number,
): number | null => {
  const step = shiftKey ? SIDEBAR_KEY_STEP_LARGE : SIDEBAR_KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampSidebarWidth(width - step, viewportWidth);
    case 'ArrowRight':
      return clampSidebarWidth(width + step, viewportWidth);
    case 'Home':
      return SIDEBAR_MIN_WIDTH;
    case 'End':
      return sidebarMaxWidthFor(viewportWidth);
    case 'Enter':
      return SIDEBAR_DEFAULT_WIDTH;
    default:
      return null;
  }
};
