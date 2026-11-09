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
const backgroundSource = readFileSync(path.join(here, '..', 'components', 'branding', 'ThemeBackground.tsx'), 'utf8');
const appContentSource = readFileSync(path.join(here, '..', 'components', 'app', 'AppContent.tsx'), 'utf8');
const indexHtmlSource = readFileSync(path.join(here, '..', '..', 'index.html'), 'utf8');

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

  it('по умолчанию оранжевая, не стекло', () => {
    const match = contextSource.match(/export const DEFAULT_THEME = '([^']+)'/);
    assert.equal(match?.[1], 'ember');
  });

  it('у оранжевой темы в списке живых обоев есть угольки, биткоин и город', () => {
    assert.match(contextSource, /id: 'coals',\s*label: 'Угольки'/);
    assert.match(contextSource, /id: 'bitcoin',\s*label: 'Биткоин'/);
    assert.match(contextSource, /id: 'city',\s*label: 'Город'/);
    assert.match(contextSource, /id: 'salute',\s*label: 'Салют'/);
    assert.match(contextSource, /id: 'coin',\s*label: 'Монета'/);
    assert.match(contextSource, /id: 'car',\s*label: 'Машина'/);
    assert.match(contextSource, /id: 'vortex',\s*label: 'Вихрь'/);
    assert.match(contextSource, /id: 'spark',\s*label: 'Искра'/);
    assert.match(contextSource, /id: 'lightning',\s*label: 'Молния'/);
    assert.match(contextSource, /VIDEO_THEMES = \['ember'\]/);
    assert.match(contextSource, /LIVE_WALLPAPER_AUTO = 'auto'/);
  });

  it('круг живых обоев прыгает с последнего на первый и не включает выкл и автосмену', () => {
    const match = contextSource.match(
      /export const nextLiveWallpaperId = \([\s\S]*?\n\};\n/
    );
    assert.ok(match, 'не нашёл nextLiveWallpaperId');
    assert.match(match[0], /ids\[\(idx \+ 1\) % ids\.length\]/);
    assert.doesNotMatch(match[0], /LIVE_WALLPAPER_OFF|'off'|LIVE_WALLPAPER_AUTO|'auto'/);
  });

  it('«Светлая Claude» зарегистрирована светлой и плоской', () => {
    assert.ok(themes.includes('claudeLight'), 'claudeLight нет в THEMES');
    assert.match(contextSource, /^\s{2}claudeLight: 'Светлая Claude',$/m);
    assert.ok(lightThemes.includes('claudeLight'), 'claudeLight должна быть в LIGHT_THEMES');
    const flat = backgroundSource.match(/FLAT_THEMES = new Set\(\[([^\]]*)\]\)/);
    assert.ok(flat, 'не нашёл FLAT_THEMES');
    assert.match(flat[1], /'claudeLight'/, 'claudeLight должна быть плоской: без картинки и шейдера');
    // Плоская тема без картинки: фон-компонент для неё не рендерится вовсе.
    const gate = appContentSource.match(/\{\(([^\n]*?customBackgroundUrl)\) && \(/);
    assert.ok(gate, 'не нашёл условие фона в AppContent');
    assert.match(gate[1], /'claudeLight'/);
  });

  it('скрипт до первой отрисовки знает те же светлые темы', () => {
    // Тема ставится в index.html ДО загрузки бандла, иначе светлая тема
    // мигает тёмным. Список светлых там продублирован — он обязан совпадать.
    const boot = indexHtmlSource.match(/var LIGHT_THEMES = \[([^\]]*)\]/);
    assert.ok(boot, 'в index.html нет inline-скрипта темы с LIGHT_THEMES');
    const bootLight = [...boot[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    assert.deepEqual([...bootLight].sort(), [...lightThemes].sort());
    assert.match(indexHtmlSource, /localStorage\.getItem\('appTheme'\)/);
  });
});

/** Токены одного блока `[data-theme='…'] { … }` из index.css. */
function readThemeTokens(theme: string): Record<string, string> {
  const start = cssSource.indexOf(`[data-theme='${theme}'] {`);
  assert.ok(start >= 0, `нет блока темы ${theme}`);
  const body = cssSource.slice(start, cssSource.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

/** WCAG 2.x: относительная яркость и контраст по тройке HSL из токена. */
function hslToRgb(triplet: string): [number, number, number] {
  const match = triplet.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  assert.ok(match, `не тройка HSL: ${triplet}`);
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((c) => c * 255) as [number, number, number];
}
function luminance(triplet: string): number {
  const [r, g, b] = hslToRgb(triplet).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('«Светлая Claude»: палитра и контраст', () => {
  const tokens = readThemeTokens('claudeLight');
  const sidebar = tokens['--sidebar'];

  it('цвета как у светлого приложения Claude', () => {
    // Ориентиры из брифа: фон слоновая кость ~#FAF9F5 = 48 33% 97%, текст ~#141413.
    assert.equal(tokens['--background'], '48 33% 97%');
    assert.equal(tokens['--card'], '0 0% 100%');
    assert.equal(tokens['--foreground'], '60 3% 8%');
    assert.ok(sidebar, 'нет токена --sidebar (сайдбар чуть темнее фона)');
    assert.ok(luminance(sidebar) < luminance(tokens['--background']), 'сайдбар должен быть темнее фона');
    // Заливка акцента — фирменная терракота #D97757 = 15 63% 60%.
    assert.equal(tokens['--accent-fill'], '15 63% 60%');
  });

  it('основной, вторичный текст и ссылки держат ≥4.5:1 на всех поверхностях', () => {
    const surfaces = { background: tokens['--background'], card: tokens['--card'], sidebar, muted: tokens['--muted'] };
    const texts = {
      foreground: tokens['--foreground'],
      'muted-foreground': tokens['--muted-foreground'],
      'primary (ссылки и текст акцента)': tokens['--primary'],
    };
    for (const [textName, text] of Object.entries(texts)) {
      for (const [surfaceName, surface] of Object.entries(surfaces)) {
        const ratio = contrast(text, surface);
        assert.ok(ratio >= 4.5, `${textName} на ${surfaceName}: ${ratio.toFixed(2)}:1 < 4.5:1`);
      }
    }
  });

  it('подпись на кнопке акцента читается (≥4.5:1)', () => {
    const ratio = contrast(tokens['--primary-foreground'], tokens['--primary']);
    assert.ok(ratio >= 4.5, `primary-foreground на primary: ${ratio.toFixed(2)}:1`);
  });
});


describe('«Био — голубая»: палитра hu22.ai, шрифты и контраст', () => {
  it('зарегистрирована тёмной и плоской, подпись «Био — голубая»', () => {
    assert.ok(themes.includes('bio'), 'bio нет в THEMES');
    assert.match(contextSource, /^\s{2}bio: 'Био — голубая',$/m);
    assert.ok(!lightThemes.includes('bio'), 'bio тёмная — не в LIGHT_THEMES');
    const flat = backgroundSource.match(/FLAT_THEMES = new Set\(\[([^\]]*)\]\)/);
    assert.ok(flat, 'не нашёл FLAT_THEMES');
    assert.match(flat[1], /'bio'/, 'bio плоская: без картинки и шейдера');
  });

  const tokens = readThemeTokens('bio');

  it('цвета, радиус и тени как на hu22.ai', () => {
    // Палитра из spec.md: фон #030305, карточка #0a0a0e, текст #ededf0,
    // серый #8b8b93, акцент #38c6f4, текст на акценте #04121c.
    assert.equal(tokens['--background'], '240 25% 1.6%');
    assert.equal(tokens['--card'], '240 16.7% 4.7%');
    assert.equal(tokens['--foreground'], '240 9.1% 93.5%');
    assert.equal(tokens['--muted-foreground'], '240 3.6% 56.1%');
    assert.equal(tokens['--primary'], '195 89.5% 58.8%');
    assert.equal(tokens['--primary-foreground'], '205 75% 6.3%');
    assert.equal(tokens['--ring'], tokens['--primary']);
    assert.equal(tokens['--radius'], '0.75rem');
    for (const shadow of ['--shadow-1', '--shadow-2', '--shadow-3']) {
      assert.equal(tokens[shadow], 'none', `${shadow} — тема разделяет поверхности линией, не тенью`);
    }
  });

  it('шрифты свои: General Sans со стеком system-ui, IBM Plex Mono для цифр', () => {
    assert.match(tokens['--font-ui'], /^"General Sans", system-ui/);
    assert.match(tokens['--font-mono'], /^"IBM Plex Mono"/);
    // Шрифты лежат в самом Neo3 — ни одного обращения к внешним шрифтовым CDN.
    const faces = [...cssSource.matchAll(/@font-face\s*{[^}]*}/g)].map((entry) => entry[0]);
    const bioFaces = faces.filter((face) => /General Sans|IBM Plex Mono/.test(face));
    assert.equal(bioFaces.length, 11, 'General Sans ×5 + IBM Plex Mono 2 веса × 3 подмножества');
    for (const face of bioFaces) {
      assert.match(face, /src:\s*url\('\/fonts\/[A-Za-z0-9-]+\.woff2'\) format\('woff2'\)/);
      assert.match(face, /font-display:\s*swap/);
    }
    assert.doesNotMatch(cssSource, /fontshare/);
  });

  it('основной и серый текст, подпись на кнопке держат ≥4.5:1', () => {
    const pairs: Array<[string, string, string]> = [
      ['foreground на background', tokens['--foreground'], tokens['--background']],
      ['muted-foreground на background', tokens['--muted-foreground'], tokens['--background']],
      ['primary-foreground на primary', tokens['--primary-foreground'], tokens['--primary']],
      ['muted-foreground на card', tokens['--muted-foreground'], tokens['--card']],
    ];
    for (const [name, text, surface] of pairs) {
      const ratio = contrast(text, surface);
      assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  });
});
