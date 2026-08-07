import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Сторож реестра тем.
 *
 * Тема живёт в трёх местах сразу: список `THEMES` (выпадашка в настройках),
 * CSS-блок `[data-theme='…']` (собственно оформление) и, для светлых, список
 * `LIGHT_THEMES`. Рассинхрон ни один из существующих тестов не ловил, а
 * выглядит он паршиво: пункт в списке есть, а выбор его ничего не меняет —
 * тема молча остаётся предыдущей.
 *
 * Файлы читаем как текст, а не импортируем: `ThemeContext.jsx` тянет за собой
 * React и сетевой слой, которым в юнит-тесте делать нечего.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const contextSource = readFileSync(path.join(here, 'ThemeContext.jsx'), 'utf8');
const cssSource = readFileSync(path.join(here, '..', 'index.css'), 'utf8');

/** Достаёт список строковых литералов из экспортируемого массива по имени. */
function readStringArray(name: string): string[] {
  const match = contextSource.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(match, `не нашёл массив ${name} в ThemeContext.jsx`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

const themes = readStringArray('THEMES');
const lightThemes = readStringArray('LIGHT_THEMES');
const themeLabels = [...contextSource.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'[^']*',$/gm)]
  .map((entry) => entry[1]);

describe('реестр тем', () => {
  it('список тем не пуст и без дублей', () => {
    assert.ok(themes.length > 0);
    assert.equal(new Set(themes).size, themes.length, 'в THEMES есть дубли');
  });

  it('у каждой темы есть свой блок в index.css', () => {
    // Исключений больше нет: `default` и `aether` были единственными темами без
    // собственной палитры, и обе вырезаны 07.08 вместе с Apple и Command Deck.
    for (const theme of themes) {
      assert.ok(
        cssSource.includes(`[data-theme='${theme}']`),
        `тема ${theme} есть в списке, но её CSS-блока нет — выбор темы ничего не изменит`
      );
    }
  });

  it('у каждой темы есть подпись в выпадашке', () => {
    for (const theme of themes) {
      assert.ok(themeLabels.includes(theme), `у темы ${theme} нет подписи в THEME_LABELS`);
    }
  });

  it('светлые темы перечислены среди существующих', () => {
    for (const theme of lightThemes) {
      assert.ok(themes.includes(theme), `${theme} помечена светлой, но её нет в THEMES`);
    }
  });

  it('тема по умолчанию существует', () => {
    const match = contextSource.match(/export const DEFAULT_THEME = '([^']+)'/);
    assert.ok(match, 'не нашёл DEFAULT_THEME');
    assert.ok(themes.includes(match[1]), `тема по умолчанию ${match[1]} отсутствует в THEMES`);
  });
});
