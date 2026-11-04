import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TERMINAL_OPTIONS, terminalThemeFor } from './constants';

// Тёмная палитра xterm, какой она была до светлой темы (VS Code Dark).
// Тёмные темы обязаны получить её байт в байт.
const PREVIOUS_DARK = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('палитра терминала по теме', () => {
  it('тёмная тема получает прежнюю палитру без изменений', () => {
    const dark = terminalThemeFor(true);
    for (const [key, value] of Object.entries(PREVIOUS_DARK)) {
      assert.equal((dark as Record<string, unknown>)[key], value, `тёмная палитра: ${key}`);
    }
    assert.equal(dark.extendedAnsi?.length, 16);
    // Терминал создаётся с тёмной палитрой, как раньше.
    assert.deepEqual(TERMINAL_OPTIONS.theme, dark);
  });

  it('светлая тема: светлый фон и читаемый текст', () => {
    const light = terminalThemeFor(false);
    assert.ok(luminance(light.background!) > 0.85, `фон ${light.background} не светлый`);
    assert.ok(contrast(light.foreground!, light.background!) >= 7, 'основной текст терминала < 7:1');
    assert.ok(contrast(light.cursor!, light.background!) >= 4.5, 'курсор теряется на фоне');
    // Цвета вывода (ошибки, git diff, подсказки) различимы на светлом фоне.
    for (const key of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'brightBlack', 'brightRed', 'brightGreen', 'brightBlue', 'brightMagenta'] as const) {
      const ratio = contrast(light[key]!, light.background!);
      assert.ok(ratio >= 3, `${key} ${light[key]} на светлом фоне: ${ratio.toFixed(2)}:1 < 3:1`);
    }
    assert.notEqual(light.background, PREVIOUS_DARK.background);
  });

  it('возвращает новый объект: присваивание в terminal.options не портит общую палитру', () => {
    assert.notEqual(terminalThemeFor(false), terminalThemeFor(false));
    assert.notEqual(terminalThemeFor(true), terminalThemeFor(true));
  });
});
