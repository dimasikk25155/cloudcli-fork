// Цвет окна настольного приложения по теме Neo3.
//
// Страница сообщает тему через preload (`neo3:theme-changed`), главный процесс
// перекрашивает окно и запоминает цвет: на следующем старте окно сразу
// открывается фоном темы, без тёмной вспышки под светлой темой.
// Модуль без зависимостей от electron — его проверяет windowTheme.test.js.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const THEME_CHANGED_CHANNEL = 'neo3:theme-changed';

/** Прежний стартовый цвет окна — для первого запуска и тёмных тем без записи. */
export const DEFAULT_WINDOW_BACKGROUND = '#0f172a';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Данные с той стороны IPC не доверяем: только булево и строгий hex. */
export function normalizeThemeChange(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const { isDark, background } = payload;
  if (typeof isDark !== 'boolean' || typeof background !== 'string' || !HEX_COLOR.test(background)) {
    return null;
  }
  return { isDark, background: background.toLowerCase() };
}

export function readWindowTheme(filePath) {
  try {
    return normalizeThemeChange(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

export function writeWindowTheme(filePath, theme) {
  const normalized = normalizeThemeChange(theme);
  if (!normalized) return false;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function initialWindowBackground(filePath) {
  return readWindowTheme(filePath)?.background || DEFAULT_WINDOW_BACKGROUND;
}
