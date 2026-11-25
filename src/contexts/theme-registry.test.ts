import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
const tailwindSource = readFileSync(path.join(here, '..', '..', 'tailwind.config.js'), 'utf8');

/** Достаёт список строковых литералов из экспортируемого массива по имени. */
function readStringArray(name: string): string[] {
  const match = contextSource.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(match, `не нашёл массив ${name} в ThemeContext.jsx`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

/** Убранные темы: ни в реестре, ни в CSS их быть не должно. */
const REMOVED_THEMES = [
  'gt', 'editorial', 'claude', 'neonCity', 'synthwaveDrive', 'nebulaFlow',
  'missionControl', 'bento3d', 'liquidChrome', 'zenParticles', 'kineticType',
];
const NEON_VARIANT_IDS = ['city', 'synthwave', 'nebula', 'mission', 'bento', 'chrome', 'zen', 'kinetic'];

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

  it('тем ровно шесть, в порядке выбора, с подписями из спецификации', () => {
    assert.deepEqual(themes, ['ember', 'codex', 'bio', 'neon', 'glass', 'claudeLight']);
    const labels: Record<string, string> = {
      ember: 'Оранжевая',
      codex: 'Графит',
      bio: 'Био',
      neon: 'Неон',
      glass: 'Бирюзовая',
      claudeLight: 'Светлая Claude',
    };
    for (const [theme, label] of Object.entries(labels)) {
      assert.match(contextSource, new RegExp(`^\\s{2}${theme}: '${label}',$`, 'm'), `подпись темы ${theme}`);
    }
    assert.equal(themeLabels.length, 6, 'в THEME_LABELS остались подписи убранных тем');
    assert.deepEqual([...lightThemes].sort(), ['claudeLight', 'glass']);
  });

  it('убранные темы не существуют ни в реестре, ни в CSS', () => {
    for (const removed of REMOVED_THEMES) {
      assert.ok(!themes.includes(removed), `${removed} всё ещё в THEMES`);
      assert.ok(
        !cssSource.includes(`[data-theme='${removed}']`) && !cssSource.includes(`[data-theme="${removed}"]`),
        `в index.css остался селектор темы ${removed}`
      );
    }
  });

  it('«Неон» — одна тема и восемь коротких блоков вариантов', () => {
    assert.ok(cssSource.includes("[data-theme='neon'] {"), 'нет блока темы neon');
    for (const variant of NEON_VARIANT_IDS) {
      const tokens = readBlockTokens(`[data-theme='neon'][data-theme-variant='${variant}'] {`);
      assert.ok(tokens['--primary'], `вариант ${variant} не задаёт акцент`);
      // Вариант — только акцент и то, что от него зависит: поверхности, шрифт,
      // форма и стекло у всех восьми общие, иначе это снова восемь тем.
      const names = Object.keys(tokens);
      assert.ok(names.length <= 5, `вариант ${variant}: ${names.length} значений — это уже отдельная тема`);
      for (const name of names) {
        assert.match(name, /^--(primary|accent|accent-foreground|ring|neon-[a-z0-9-]+)$/, `вариант ${variant} задаёт ${name}`);
      }
    }
    const variantBlocks = [...cssSource.matchAll(/\[data-theme='neon'\]\[data-theme-variant='([a-z]+)'\] \{/g)]
      .map((entry) => entry[1]);
    assert.deepEqual(variantBlocks, NEON_VARIANT_IDS);
    // Акценты вариантов различимы: тон соседей отличается минимум на 20°.
    const hues = NEON_VARIANT_IDS
      .map((variant) => Number(readBlockTokens(`[data-theme='neon'][data-theme-variant='${variant}'] {`)['--primary'].split(' ')[0]))
      .sort((a, b) => a - b);
    hues.forEach((hue, index) => {
      const next = index === hues.length - 1 ? hues[0] + 360 : hues[index + 1];
      assert.ok(next - hue >= 20, `акценты ${hue}° и ${next % 360}° слишком близки`);
    });
  });

  it('контекст отдаёт вариант «Неона» и ставит его атрибутом только у этой темы', () => {
    assert.match(contextSource, /^\s{4}neonVariant,$/m, 'в значении useTheme() нет neonVariant');
    assert.match(contextSource, /^\s{4}setNeonVariant,$/m, 'в значении useTheme() нет setNeonVariant');
    assert.match(contextSource, /root\.setAttribute\('data-theme-variant', neonVariant\)/);
    assert.match(contextSource, /root\.removeAttribute\('data-theme-variant'\)/);
    assert.match(contextSource, /localStorage\.setItem\('neonVariant', neonVariant\)/);
    // Вариант — свой на устройстве: в аккаунт не уходит.
    assert.doesNotMatch(contextSource, /JSON\.stringify\(\{\s*neonVariant/);
  });

  it('фон: «Неон» — фото варианта, плоские темы — без картинки, оранжевая — видео', () => {
    const flat = backgroundSource.match(/FLAT_THEMES = new Set\(\[([^\]]*)\]\)/);
    assert.ok(flat, 'не нашёл FLAT_THEMES');
    assert.deepEqual(
      [...flat[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort(),
      ['bio', 'claudeLight', 'codex', 'glass']
    );
    const photo = backgroundSource.match(/PHOTO_THEMES = new Set\(\[([^\]]*)\]\)/);
    assert.ok(photo, 'не нашёл PHOTO_THEMES');
    assert.deepEqual([...photo[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]), ['neon']);
    assert.match(backgroundSource, /neonVariantFile\(neonVariant\)/, 'фото «Неона» берётся по варианту');
    assert.match(backgroundSource, /isVideoTheme\(theme\)/);
    // Условие фона больше не знает убранной тёмной «Claude».
    const gate = appContentSource.match(/\{\(([^\n]*?customBackgroundUrl)\) && \(/);
    assert.ok(gate, 'не нашёл условие фона в AppContent');
    assert.doesNotMatch(gate[1], /'claude'/);
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
    assert.match(contextSource, /id: 'show',\s*label: 'Биткоин-шоу',\s*tall: true/);
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

/** Токены блока, который открывается строкой `opener` и идёт до первой `\n}`. */
function readBlockTokens(opener: string): Record<string, string> {
  const start = cssSource.indexOf(opener);
  assert.ok(start >= 0, `нет блока ${opener}`);
  const body = cssSource.slice(start, cssSource.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

/** Токены одного блока `[data-theme='…'] { … }` из index.css. */
function readThemeTokens(theme: string): Record<string, string> {
  return readBlockTokens(`[data-theme='${theme}'] {`);
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
  it('зарегистрирована тёмной и плоской, подпись «Био»', () => {
    assert.ok(themes.includes('bio'), 'bio нет в THEMES');
    assert.match(contextSource, /^\s{2}bio: 'Био',$/m);
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

/**
 * Контракт темы: что обязана задать КАЖДАЯ тема в своём блоке. Наследование
 * от `:root` — это и была причина «темы практически идентичные»: тема меняла
 * палитру, а шрифт, форму, тени, плотность и материал брала общие.
 */
const GLASS_TOKENS = [
  '--glass-bg', '--glass-bg-strong', '--glass-blur', '--glass-saturate',
  '--glass-border', '--glass-highlight', '--glass-shadow', '--glass-fallback-bg',
];
const REQUIRED_TOKENS: Record<string, string[]> = {
  'поверхности и текст': [
    '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
    '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--border', '--input', '--ring',
  ],
  акцент: ['--primary', '--primary-foreground'],
  статусы: [
    '--destructive', '--destructive-foreground', '--success', '--success-foreground',
    '--warning', '--warning-foreground', '--info', '--info-foreground',
  ],
  'шрифт и форма': ['--font-ui', '--font-display', '--font-mono', '--tracking-ui', '--radius'],
  тени: ['--shadow-1', '--shadow-2', '--shadow-3'],
  'плотность и движение': ['--density', '--duration-fast', '--duration-base', '--duration-slow', '--ease-ui'],
  материал: [
    '--shell-bg', '--shell-material', '--shell-grain', '--shell-grain-opacity',
    '--panel-tint', '--panel-alpha', '--panel-blur-radius', '--panel-saturate',
    '--panel-bg', '--panel-blur', '--panel-border', '--panel-shadow',
  ],
  стекло: GLASS_TOKENS,
  'живые значения шторки': ['--nav-divider-color', '--nav-input-bg', '--nav-input-focus-ring'],
};

/** Первая гарнитура стека — та, которую человек реально видит. */
const firstFamily = (stack: string) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');

/** `hsl(H S% L%)` или `hsl(H S% L% / A)` → тройка `H S% L%`. */
function hslFunctionTriplet(value: string): string {
  const match = value.match(/^hsl\(\s*(-?[\d.]+\s+[\d.]+%\s+[\d.]+%)\s*(?:\/\s*[\d.]+\s*)?\)$/);
  assert.ok(match, `ожидал hsl(H S% L%): ${value}`);
  return match[1];
}

describe('шесть тем: полный набор, различимость, контраст', () => {
  const tokensByTheme = Object.fromEntries(themes.map((theme) => [theme, readThemeTokens(theme)]));

  it('каждая тема задаёт полный набор в своём блоке и ничего не наследует от :root', () => {
    for (const theme of themes) {
      for (const [group, names] of Object.entries(REQUIRED_TOKENS)) {
        for (const name of names) {
          assert.ok(
            tokensByTheme[theme][name] !== undefined && tokensByTheme[theme][name] !== '',
            `тема ${theme}: не задано ${name} (${group})`
          );
        }
      }
    }
  });

  it('любые две темы отличаются шрифтом или скруглением — и стеклом', () => {
    for (let i = 0; i < themes.length; i += 1) {
      for (let j = i + 1; j < themes.length; j += 1) {
        const [a, b] = [tokensByTheme[themes[i]], tokensByTheme[themes[j]]];
        const pair = `${themes[i]} и ${themes[j]}`;
        assert.ok(
          firstFamily(a['--font-ui']) !== firstFamily(b['--font-ui']) || a['--radius'] !== b['--radius'],
          `${pair}: один и тот же шрифт интерфейса и одно скругление`
        );
        assert.ok(
          a['--glass-bg'] !== b['--glass-bg'] || a['--glass-blur'] !== b['--glass-blur'],
          `${pair}: одно и то же стекло`
        );
      }
    }
  });

  it('характер не сводится к цвету: у тем разные скругления, плотность и скорость', () => {
    const distinct = (name: string) => new Set(themes.map((theme) => tokensByTheme[theme][name])).size;
    assert.ok(distinct('--radius') >= 5, 'скругление совпадает больше чем у одной пары тем');
    assert.ok(distinct('--density') >= 3, 'плотность у всех почти одна');
    assert.ok(distinct('--duration-base') >= 4, 'скорость движения у всех почти одна');
    assert.ok(distinct('--glass-blur') >= 5, 'размытие стекла у всех почти одно');
    assert.equal(new Set(themes.map((theme) => firstFamily(tokensByTheme[theme]['--font-ui']))).size >= 5, true);
  });

  it('основной текст ≥ 4,5:1, приглушённый ≥ 3:1, текст на акценте ≥ 4,5:1', () => {
    for (const theme of themes) {
      const tokens = tokensByTheme[theme];
      const checks: Array<[string, string, string, number]> = [
        ['основной текст на фоне', tokens['--foreground'], tokens['--background'], 4.5],
        ['основной текст на карточке', tokens['--card-foreground'], tokens['--card'], 4.5],
        ['текст всплывающего окна', tokens['--popover-foreground'], tokens['--popover'], 4.5],
        ['приглушённый текст на фоне', tokens['--muted-foreground'], tokens['--background'], 3],
        ['приглушённый текст на карточке', tokens['--muted-foreground'], tokens['--card'], 3],
        ['текст на акценте', tokens['--primary-foreground'], tokens['--primary'], 4.5],
      ];
      for (const [name, text, surface, minimum] of checks) {
        const ratio = contrast(text, surface);
        assert.ok(ratio >= minimum, `${theme}: ${name} — ${ratio.toFixed(2)}:1 < ${minimum}:1`);
      }
    }
  });

  it('каждый вариант «Неона» держит текст на акценте и акцент на фоне', () => {
    const neon = tokensByTheme.neon;
    for (const variant of NEON_VARIANT_IDS) {
      const accent = readBlockTokens(`[data-theme='neon'][data-theme-variant='${variant}'] {`)['--primary'];
      const onAccent = contrast(neon['--primary-foreground'], accent);
      assert.ok(onAccent >= 4.5, `neon/${variant}: текст на акценте ${onAccent.toFixed(2)}:1`);
      const asText = contrast(accent, neon['--background']);
      assert.ok(asText >= 4.5, `neon/${variant}: акцент как текст на фоне ${asText.toFixed(2)}:1`);
    }
  });

  it('без размытия стекло становится плотным фоном, на котором текст читается', () => {
    for (const theme of themes) {
      const tokens = tokensByTheme[theme];
      const fallback = tokens['--glass-fallback-bg'];
      assert.doesNotMatch(fallback, /\//, `${theme}: запасной фон стекла обязан быть непрозрачным`);
      const surface = hslFunctionTriplet(fallback);
      const ratio = contrast(tokens['--foreground'], surface);
      assert.ok(ratio >= 4.5, `${theme}: текст на запасном фоне стекла ${ratio.toFixed(2)}:1`);
      const muted = contrast(tokens['--muted-foreground'], surface);
      assert.ok(muted >= 3, `${theme}: приглушённый текст на запасном фоне стекла ${muted.toFixed(2)}:1`);
      assert.match(tokens['--glass-blur'], /^\d+px$/, `${theme}: --glass-blur в px`);
      assert.match(tokens['--glass-saturate'], /^\d+(\.\d+)?$/, `${theme}: --glass-saturate числом`);
      for (const name of ['--glass-bg', '--glass-bg-strong', '--glass-border', '--glass-highlight']) {
        assert.match(tokens[name], /\/\s*[\d.]+\s*\)$/, `${theme}: ${name} — цвет с альфой`);
      }
    }
  });

  it('светлые и тёмные темы помечены верно: фон светлых светлее текста', () => {
    for (const theme of themes) {
      const tokens = tokensByTheme[theme];
      const lightBackground = luminance(tokens['--background']) > luminance(tokens['--foreground']);
      assert.equal(lightBackground, lightThemes.includes(theme), `${theme}: LIGHT_THEMES не совпадает с палитрой`);
    }
  });
});

describe('стекло: классы и запасные ветки', () => {
  const start = cssSource.indexOf('/* glass:start');
  const end = cssSource.indexOf('/* glass:end */');
  const glassCss = start >= 0 && end > start ? cssSource.slice(start, end) : '';
  /** Тело первого правила, чей селектор — ровно `selector`. */
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = glassCss.match(new RegExp(`(?:^|[\\n,}])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
    return match ? match[1] : '';
  };

  // Ветка для браузеров с color-mix: всё полупрозрачное из --glass-fallback-bg
  // живёт только в ней. Объявление с var() при разборе валидно всегда, поэтому
  // «запасная строка выше» в одном правиле не работает: побеждает вторая
  // строка, а без color-mix она сбрасывает свойство целиком.
  const colorMixBranch = glassCss.match(/@supports \(color: color-mix\(in srgb, red, blue\)\)\s*\{([\s\S]*?)\n {2}\}/);
  /** Раздел стекла без этой ветки: то, что получает браузер без color-mix. */
  const glassBase = colorMixBranch ? glassCss.replace(colorMixBranch[0], '') : glassCss;
  const rulesIn = (css: string) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((entry) => ({ selector: entry[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: entry[2] }));

  it('без color-mix стекло остаётся сплошным: полупрозрачные слои — только в @supports', () => {
    assert.ok(colorMixBranch, 'ветка с color-mix не обёрнута в @supports (color: color-mix(in srgb, red, blue))');
    // Вне ветки — ни одного color-mix: старому браузеру нечего сбрасывать.
    assert.doesNotMatch(glassBase.replace(/\/\*[\s\S]*?\*\//g, ''), /color-mix\(/, 'color-mix вне @supports');
    // Плотный лист без color-mix — сплошной слой, а не прозрачный лист.
    const dense = rule('.glass-dense');
    assert.match(dense, /background-image:\s*linear-gradient\(var\(--glass-fallback-bg\), var\(--glass-fallback-bg\)\);/);
    assert.equal([...dense.matchAll(/background-image:/g)].length, 1, 'у .glass-dense вне @supports две строки фона');
    // Лист под живыми обоями без color-mix — сплошной фон.
    const sheets = rulesIn(glassBase).filter((entry) => entry.selector === 'html.has-live-wallpaper .glass-sheet');
    assert.equal(sheets.length, 1);
    assert.equal([...sheets[0].body.matchAll(/background-color:/g)].length, 1, 'у листа под живыми обоями вне @supports две строки фона');
    assert.match(sheets[0].body, /background-color:\s*var\(--glass-fallback-bg\);/);
    // В ветке — ровно эти два правила, оба через color-mix и оба после своих
    // сплошных (иначе при равной силе селектора победит сплошной).
    const inBranch = rulesIn(colorMixBranch[1]);
    assert.deepEqual(inBranch.map((entry) => entry.selector).sort(), ['.glass-dense', 'html.has-live-wallpaper .glass-sheet']);
    for (const entry of inBranch) {
      assert.match(entry.body, /color-mix\(in srgb, var\(--glass-fallback-bg\) \d+%, transparent\)/, entry.selector);
    }
    const branchAt = glassCss.indexOf(colorMixBranch[0]);
    assert.ok(branchAt > glassCss.search(/\n\s*\.glass-dense\s*\{/), 'ветка стоит раньше сплошного .glass-dense');
    assert.ok(branchAt > glassCss.search(/\n\s*html\.has-live-wallpaper \.glass-sheet\s*\{/), 'ветка стоит раньше сплошного листа под живыми обоями');
  });

  it('раздел стекла есть, и в нём шесть классов', () => {
    assert.ok(glassCss.length > 0, 'в index.css нет раздела /* glass:start … glass:end */');
    for (const name of ['glass-surface', 'glass-sheet', 'glass-pill', 'glass-button', 'glass-button-primary', 'glass-active']) {
      assert.match(glassCss, new RegExp(`\\.${name}(?![a-z-])`), `нет класса .${name}`);
    }
  });

  it('классы берут только значения --glass-*: ни жёстких цветов, ни чужих переменных', () => {
    const withoutComments = glassCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const used = [...withoutComments.matchAll(/var\((--[a-z0-9-]+)/g)].map((entry) => entry[1]);
    assert.ok(used.length > 0);
    for (const name of used) {
      assert.match(name, /^--glass-/, `класс стекла читает ${name}`);
    }
    for (const name of GLASS_TOKENS) {
      assert.ok(used.includes(name), `ни один класс стекла не читает ${name}`);
    }
    assert.doesNotMatch(withoutComments, /#[0-9a-f]{3,8}\b/i, 'жёсткий hex в классах стекла');
    assert.doesNotMatch(withoutComments, /\b(?:rgb|rgba|hsl|hsla)\(\s*[\d.]/, 'жёсткий цвет в классах стекла');
  });

  it('материал: фон, размытие с насыщенностью, кромка, блик и тень', () => {
    const blur = /backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\)/;
    assert.match(glassCss, blur);
    assert.match(glassCss, new RegExp(`-webkit-${blur.source}`), 'нет префикса для Safari');
    assert.match(glassCss, /border:\s*1px solid var\(--glass-border\)/);
    assert.match(glassCss, /box-shadow:\s*inset 0 1px 0 var\(--glass-highlight\),\s*var\(--glass-shadow\)/);
    // Под текстом — плотный фон, у мелких плавающих кнопок — лёгкий.
    assert.match(rule('.glass-surface'), /background-color:\s*var\(--glass-bg-strong\)/);
    assert.match(rule('.glass-sheet'), /background-color:\s*var\(--glass-bg-strong\)/);
    assert.match(rule('.glass-pill'), /background-color:\s*var\(--glass-bg\)/);
    assert.match(rule('.glass-button'), /background-color:\s*var\(--glass-bg\)/);
  });

  it('кнопки: круг 44×44, пилюля не ниже 36 с зоной нажатия 44, отклик и фокус', () => {
    const button = rule('.glass-button');
    assert.match(button, /width:\s*44px/);
    assert.match(button, /height:\s*44px/);
    assert.match(button, /border-radius:\s*9999px/);
    const pill = rule('.glass-pill');
    assert.match(pill, /min-height:\s*36px/);
    assert.match(pill, /border-radius:\s*9999px/);
    const hit = rule('.glass-pill::before');
    assert.match(hit, /min-height:\s*44px/, 'зона нажатия пилюли меньше 44');
    assert.match(glassCss, /\.glass-(?:pill|button)[^{]*:active[^{]*\{[^}]*transform:\s*scale\(0\.9\d\)/, 'нет сжатия при нажатии');
    const durations = [...glassCss.matchAll(/transition:[^;]*?(\d+)ms/g)].map((entry) => Number(entry[1]));
    assert.ok(durations.length > 0 && durations.every((ms) => ms <= 150), 'отклик на нажатие дольше 150 мс');
    assert.match(glassCss, /:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--glass-ring\)/, 'нет видимого фокуса');
    // Своё правило главной кнопки (не общее с .glass-button, где задана форма).
    const primary = glassCss.match(/\}\s*(?:\/\*[\s\S]*?\*\/\s*)?\.glass-button-primary\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(primary, /background-color:\s*var\(--glass-accent-bg\)/);
    assert.match(primary, /[^-]color:\s*var\(--glass-accent-fg\)/);
    // Форма у главной кнопки та же, что у обычной: круг 44×44.
    assert.match(glassCss, /\.glass-button,\s*\.glass-button-primary\s*\{/);
  });

  // ---- зона нажатия (ревью ветки, история 8) --------------------------------
  //
  // Абсолютный `::before` считается от поля ВНУТРИ кромки (padding box), а не
  // от видимого края: у кнопки 36 px с кромкой 1 px это 34 px. Прежняя запись
  // «36 + 2 × 4 = 44» считала от края и давала на деле 42.

  /** Кромка стекла в px — из общего правила материала. */
  const glassBorder = () => Number(glassCss.match(/border:\s*(\d+)px solid var\(--glass-border\)/)?.[1]);
  /** `min(0px, calc((100% - Npx) / k))` или `min(0px, calc(100% - Npx))` → [N, k]; иначе null. */
  const hitFormula = (value: string | undefined): [number, number] | null => {
    const text = value?.trim() ?? '';
    const halved = text.match(/^min\(0px,\s*calc\(\(100% - (\d+)px\) \/ (\d+)\)\)$/);
    if (halved) return [Number(halved[1]), Number(halved[2])];
    const whole = text.match(/^min\(0px,\s*calc\(100% - (\d+)px\)\)$/);
    return whole ? [Number(whole[1]), 1] : null;
  };
  const declaration = (body: string, name: string) => body.match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`))?.[1];

  it('круглая кнопка: зона нажатия ≥ 44×44 px от поля внутри кромки, в px и в самом классе', () => {
    assert.match(glassCss, /\.glass-button::before,\s*\.glass-button-primary::before\s*\{/, 'у круглых кнопок нет своей зоны нажатия в классах стекла');
    const hit = rule('.glass-button::before');
    assert.match(hit, /content:\s*''/);
    assert.match(hit, /position:\s*absolute/);
    const formula = hitFormula(declaration(hit, 'inset'));
    assert.ok(formula, 'зона нажатия задана не формулой в px от поля внутри кромки');
    const [target, divisor] = formula;
    assert.equal(divisor, 2, 'зона должна расти поровну в обе стороны');
    // Ни плотности темы, ни rem: зона одна во всех шести темах и при любом масштабе.
    assert.doesNotMatch(hit, /var\(|\d(?:rem|em)\b/);
    const border = glassBorder();
    assert.equal(border, 1);
    // Видимые размеры кнопок: 36 (шапки, «Назад», поле ввода), 40 («отправить»), 44 (сам класс), 28 — запас.
    for (const visible of [28, 36, 40, 44, 56]) {
      const paddingBox = visible - 2 * border;
      const outset = Math.max(0, (target - paddingBox) / divisor);
      const zone = paddingBox + 2 * outset;
      assert.ok(zone >= 44, `кнопка ${visible} px: зона нажатия ${zone} px`);
    }
  });

  it('зону нажатия круглой кнопки не перебивает ни правило рядом, ни утилита в разметке', () => {
    // Правило вне раздела стекла (поле ввода) сильнее класса: с `inset: -4px`
    // кнопка 36 px получала 34 + 8 = 42.
    const outside = cssSource.replace(glassCss, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const overrides = [...outside.matchAll(/([^{}]*\.glass-button(?:-primary)?::before[^{}]*)\{/g)].map((entry) => entry[1].trim());
    assert.deepEqual(overrides, [], 'зону нажатия круглой кнопки задаёт правило мимо классов стекла');

    // Утилита `before:-inset-…` тоже сильнее класса. Там, где она есть, зона
    // считается так же — от поля внутри кромки.
    const componentsDir = path.join(here, '..', 'components');
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(file);
      return /\.tsx$/.test(entry.name) ? [file] : [];
    });
    const border = glassBorder();
    let checked = 0;
    for (const file of sources(componentsDir)) {
      const source = readFileSync(file, 'utf8');
      for (const [literal] of source.matchAll(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\bglass-button(?:-primary)?\b(?:(?!\1)[^\\\n]|\\.)*\1/g)) {
        checked += 1;
        const utility = literal.match(/(?:^|[\s"'`])before:-inset-(?:\[(\d+(?:\.\d+)?)px\]|(\d+(?:\.\d+)?))(?=[\s"'`])/);
        if (!utility) continue; // зона — из класса стекла, проверена выше
        const outset = utility[1] !== undefined ? Number(utility[1]) : Number(utility[2]) * 4;
        const size = literal.match(/(?:^|[\s"'`])h-(\d+(?:\.\d+)?)(?=[\s"'`])/);
        const visible = size ? Number(size[1]) * 4 : 44;
        const zone = visible - 2 * border + 2 * outset;
        assert.ok(zone >= 44, `${path.relative(componentsDir, file)}: кнопка ${visible} px, зона нажатия ${zone} px (${utility[0].trim()})`);
      }
    }
    assert.ok(checked >= 8, `круглых кнопок найдено ${checked} — разбор исходников сломался`);
  });

  it('язычок быстрых настроек: зона нажатия ≥ 44×44 px в классе стекла, вширь растёт внутрь экрана', () => {
    const hit = rule('.glass-handle::before');
    assert.ok(hit, 'нет зоны нажатия язычка в классах стекла');
    assert.match(hit, /content:\s*''/);
    assert.match(hit, /position:\s*absolute/);
    assert.doesNotMatch(hit, /var\(|\d(?:rem|em)\b/);
    // По высоте — поровну вверх и вниз, по ширине — только влево: справа край экрана.
    for (const side of ['top', 'bottom']) {
      const formula = hitFormula(declaration(hit, side));
      assert.ok(formula && formula[0] >= 44 && formula[1] === 2, `${side}: зона язычка по высоте меньше 44 px`);
    }
    const left = hitFormula(declaration(hit, 'left'));
    assert.ok(left && left[0] >= 44 && left[1] === 1, 'left: зона язычка по ширине меньше 44 px');
    assert.equal(declaration(hit, 'right')?.trim(), '0');
    // Язычок берёт зону из класса, а не из утилит, которые едут от плотности темы.
    const handle = readFileSync(
      path.join(here, '..', 'components', 'quick-settings-panel', 'view', 'QuickSettingsHandle.tsx'),
      'utf8',
    );
    const classes = handle.match(/className=\{`([^`]*)`\}/)?.[1] ?? '';
    assert.match(classes, /(^|\s)glass-handle(\s|$)/);
    assert.doesNotMatch(classes, /(^|\s)before:/, 'зона нажатия язычка задана утилитами');
  });

  it('запасные ветки: «уменьшить прозрачность», нет backdrop-filter, «уменьшить движение»', () => {
    const opaque = /background-color:\s*var\(--glass-fallback-bg\)[^}]*backdrop-filter:\s*none/;
    const reducedTransparency = glassCss.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n {2}\}/);
    assert.ok(reducedTransparency, 'нет ветки prefers-reduced-transparency');
    assert.match(reducedTransparency[1], opaque);
    const noBackdrop = glassCss.match(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{([\s\S]*?)\n {2}\}/
    );
    assert.ok(noBackdrop, 'нет ветки @supports not (backdrop-filter…)');
    assert.match(noBackdrop[1], /background-color:\s*var\(--glass-fallback-bg\)/);
    const reducedMotion = glassCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {2}\}/);
    assert.ok(reducedMotion, 'нет ветки prefers-reduced-motion');
    assert.match(reducedMotion[1], /transition:\s*none/);
    assert.match(reducedMotion[1], /transform:\s*none/);
    // Во всех трёх ветках перечислены все четыре поверхности.
    for (const branch of [reducedTransparency[1], noBackdrop[1]]) {
      for (const name of ['glass-surface', 'glass-sheet', 'glass-pill', 'glass-button']) {
        assert.match(branch, new RegExp(`\\.${name}(?![a-z-])`), `ветка не покрывает .${name}`);
      }
    }
  });

  it('под живыми обоями лист и затемнение теряют размытие, плавающие элементы — нет', () => {
    // Основные правила — вне ветки @supports (color-mix): в ней лист только
    // меняет плотность фона, размытие снято здесь.
    const live = [...glassBase.matchAll(/html\.has-live-wallpaper ([^{]*)\{([^}]*)\}/g)]
      .map((entry) => ({ selector: entry[1].trim(), body: entry[2] }));
    // Большие площади — лист и затемнение на весь экран. Кнопки, пилюли и
    // карточка ввода размытие сохраняют.
    assert.deepEqual(live.map((entry) => entry.selector).sort(), ['.glass-scrim', '.glass-sheet']);
    for (const entry of live) {
      assert.match(entry.body, /[^-]backdrop-filter:\s*none/, `${entry.selector}: размытие не снято`);
      assert.match(entry.body, /-webkit-backdrop-filter:\s*none/, `${entry.selector}: нет префикса Safari`);
    }
    const sheet = live.find((entry) => entry.selector === '.glass-sheet');
    assert.match(sheet?.body ?? '', /background-color:\s*var\(--glass-fallback-bg\)/);
    // Затемнение остаётся затемнением: плотный фон листа ему не достаётся.
    const scrim = live.find((entry) => entry.selector === '.glass-scrim');
    assert.doesNotMatch(scrim?.body ?? '', /background/);
  });

  it('затемнение за листом ещё и размывает фон — значениями стекла темы', () => {
    const scrim = rule('.glass-scrim');
    assert.match(scrim, /background-color:\s*var\(--glass-scrim\)/);
    const blur = /backdrop-filter:\s*blur\([^;]*var\(--glass-blur\)[^;]*\)/;
    assert.match(scrim, new RegExp(`[^-]${blur.source}`), 'затемнение не размывает фон за листом');
    assert.match(scrim, new RegExp(`-webkit-${blur.source}`), 'нет префикса для Safari');
  });

  it('без прозрачности и без backdrop-filter от затемнения остаётся только затемнение', () => {
    const rulesOf = (css: string) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map((entry) => ({ selector: entry[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: entry[2] }));
    const reducedTransparency = glassCss.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n {2}\}/);
    assert.ok(reducedTransparency, 'нет ветки prefers-reduced-transparency');
    const reduced = rulesOf(reducedTransparency[1]).filter((entry) => /\.glass-scrim(?![a-z-])/.test(entry.selector));
    assert.equal(reduced.length, 1, 'в ветке «уменьшить прозрачность» нет своего правила затемнения');
    assert.match(reduced[0].body, /[^-]backdrop-filter:\s*none/);
    assert.match(reduced[0].body, /-webkit-backdrop-filter:\s*none/);
    assert.doesNotMatch(reduced[0].body, /background/, 'затемнение не должно становиться плотным фоном');
    // Браузер без backdrop-filter объявление размытия просто не понимает —
    // остаётся цвет --glass-scrim. Плотный фон листа затемнению не назначается.
    const noBackdrop = glassCss.match(
      /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)\s*\{([\s\S]*?)\n {2}\}/
    );
    assert.ok(noBackdrop, 'нет ветки @supports not (backdrop-filter…)');
    for (const entry of rulesOf(noBackdrop[1])) {
      if (/\.glass-scrim(?![a-z-])/.test(entry.selector)) {
        assert.doesNotMatch(entry.body, /background/, 'без backdrop-filter затемнение обязано остаться затемнением');
      }
    }
    // Само затемнение от размытия не зависит: цвет задан в основном правиле.
    assert.match(rule('.glass-scrim'), /background-color:\s*var\(--glass-scrim\)/);
  });

  it('затемнение за листом — свой тёмный цвет темы, а не её фон', () => {
    // Разбор D2: шторку затемняли цветом --background, и в светлой теме вуаль
    // осветляла экран под шторкой вместо того, чтобы его затемнить.
    assert.match(rule('.glass-scrim'), /background-color:\s*var\(--glass-scrim\)/);
    for (const theme of themes) {
      const scrim = readThemeTokens(theme)['--glass-scrim'];
      assert.ok(scrim, `тема ${theme}: нет --glass-scrim`);
      const lightness = Number(hslFunctionTriplet(scrim).split(/\s+/)[2].replace('%', ''));
      assert.ok(lightness <= 20, `тема ${theme}: затемнение светлое (${lightness}%)`);
    }
  });

  const DERIVED = ['--glass-ring', '--glass-accent-bg', '--glass-accent-fg', '--glass-active-bg', '--glass-active-fg', '--glass-radius'];

  it('производные значения стекла заданы один раз в :root', () => {
    const rootStart = cssSource.indexOf(':root {');
    const rootBlock = cssSource.slice(rootStart, cssSource.indexOf('\n  }', rootStart));
    for (const name of DERIVED) {
      assert.match(rootBlock, new RegExp(`^\\s*${name}:`, 'm'), `в :root нет ${name}`);
    }
  });

  it('производные пересчитываются в любом элементе с data-theme, а не остаются от темы страницы', () => {
    // var() подставляется там, где значение объявлено: объявленное только в
    // :root считается из акцента темы страницы и наследуется готовым цветом.
    // Вложенный data-theme (карточка-превью темы) получал чужое кольцо фокуса
    // и чужую заливку главной кнопки.
    const nested = cssSource.match(/\n\s*\[data-theme\]\s*\{([^}]*)\}/);
    assert.ok(nested, 'нет правила [data-theme] { … } с производными стекла');
    const rootStart = cssSource.indexOf(':root {');
    const rootBlock = cssSource.slice(rootStart, cssSource.indexOf('\n  }', rootStart));
    for (const name of DERIVED) {
      const declaration = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm');
      const inRoot: string | undefined = rootBlock.match(declaration)?.[1];
      const inNested: string | undefined = nested[1].match(declaration)?.[1];
      assert.ok(inNested, `[data-theme] не пересчитывает ${name}`);
      assert.equal(inNested, inRoot, `${name}: в :root и в [data-theme] разные формулы`);
    }
    // Тема, у которой производное своё, обязана перебить общее правило:
    // блоки тем без слоя, общее правило — в слое.
    const before = cssSource.slice(0, cssSource.indexOf(nested[0]));
    const layerAt = before.search(/@layer [a-z]+ \{(?![\s\S]*@layer [a-z]+ \{)/);
    assert.ok(
      layerAt >= 0 && !/\n\}/.test(before.slice(layerAt)),
      'правило [data-theme] должно лежать внутри @layer, иначе перебьёт значения тем'
    );
  });

  it('значок на залитой кнопке держит ≥ 4,5:1 в каждой теме и в каждом варианте «Неона»', () => {
    const rootStart = cssSource.indexOf(':root {');
    const rootBlock = cssSource.slice(rootStart, cssSource.indexOf('\n  }', rootStart));
    const rootValue = (name: string) => rootBlock.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))?.[1] ?? '';
    /** `hsl(var(--x))` → тройка темы; `hsl(H S% L%)` → она сама. */
    const resolve = (value: string, tokens: Record<string, string>): string => {
      const viaVar = value.match(/^hsl\(var\((--[a-z-]+)\)\)$/);
      if (viaVar) {
        assert.ok(tokens[viaVar[1]], `нет значения ${viaVar[1]}`);
        return tokens[viaVar[1]];
      }
      return hslFunctionTriplet(value);
    };
    for (const theme of themes) {
      const tokens = readThemeTokens(theme);
      const fill = resolve(tokens['--glass-accent-bg'] ?? rootValue('--glass-accent-bg'), tokens);
      const icon = resolve(tokens['--glass-accent-fg'] ?? rootValue('--glass-accent-fg'), tokens);
      const ratio = contrast(icon, fill);
      assert.ok(ratio >= 4.5, `${theme}: значок на залитой кнопке ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  });

  it('плотный лист: шторка телефона не прозрачнее 0,97 и не зависит от размытия', () => {
    const dense = rule('.glass-dense');
    assert.ok(dense, 'нет модификатора .glass-dense');
    // Плотность кладётся отдельным слоем поверх фона листа — её не стирают ни
    // живые обои, ни запасные ветки. Слой в 97% — в ветке @supports (color-mix);
    // без color-mix слой сплошной (тест выше), то есть плотнее, а не прозрачнее.
    const denseMix = rulesIn(colorMixBranch?.[1] ?? '').find((entry) => entry.selector === '.glass-dense')?.body ?? '';
    const mix = denseMix.match(/background-image:\s*linear-gradient\(\s*color-mix\(in srgb, var\(--glass-fallback-bg\) (\d+)%, transparent\)/);
    assert.ok(mix, '.glass-dense не кладёт плотный слой из --glass-fallback-bg');
    assert.ok(Number(mix[1]) >= 97, `плотность листа ${mix[1]}% < 97%`);
    assert.match(dense, /background-image:\s*linear-gradient\(var\(--glass-fallback-bg\), var\(--glass-fallback-bg\)\);/);
    assert.match(dense, /[^-]backdrop-filter:\s*none/, 'плотный лист платит за размытие, которого не видно');
    assert.match(appContentSource, /app-sidebar glass-sheet glass-dense /, 'шторка телефона не помечена .glass-dense');
  });

  it('темы не перекрашивают лист шторки: их правила .app-sidebar — только для боковой панели компьютера', () => {
    const rules = [...cssSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((entry) => ({ selector: entry[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: entry[2] }));
    for (const { selector, body } of rules) {
      if (!/background|backdrop-filter|box-shadow|border/.test(body)) continue;
      for (const part of selector.split(',').map((item) => item.trim())) {
        // Правило самой панели (не её потомков) под темой.
        if (/^\[data-theme[^\]]*\](?:\.[a-z-]+)* \.app-sidebar$/.test(part)) {
          assert.fail(`«${part}» сильнее .glass-sheet — шторка телефона снова просвечивает; пиши .app-sidebar:not(.glass-sheet)`);
        }
      }
    }
  });

  it('темы не перекрашивают поле ввода мимо стекла', () => {
    // Хвосты `[data-theme=…] [data-slot='prompt-input']` сильнее .glass-surface:
    // с ними поле ввода в каждой теме было своей заливкой, а не стеклом.
    const rules = [...cssSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((entry) => ({ selector: entry[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: entry[2] }));
    const material = /(?:^|[\s;])(background(?:-color)?|backdrop-filter|-webkit-backdrop-filter|box-shadow|border(?:-color|-radius)?)\s*:\s*([^;]+);/g;
    for (const { selector, body } of rules) {
      if (!/\[data-slot='prompt-input'\]/.test(selector)) continue;
      for (const declaration of body.matchAll(material)) {
        const value = declaration[2].trim();
        const usesOnlyGlass = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].every((entry) => entry[1].startsWith('--glass-'));
        const hasGlass = /var\(--glass-/.test(value);
        assert.ok(
          hasGlass && usesOnlyGlass && !/#[0-9a-f]{3,8}\b|\bhsl\(\s*\d/i.test(value),
          `«${selector}»: ${declaration[1]}: ${value} — поле ввода красится мимо значений стекла`
        );
      }
    }
  });
});

describe('нижняя панель: место под неё', () => {
  it('по умолчанию ноль, с классом has-bottom-bar — 64px плюс нижний отступ айфона', () => {
    const rootStart = cssSource.indexOf(':root {');
    const rootBlock = cssSource.slice(rootStart, cssSource.indexOf('\n  }', rootStart));
    assert.match(rootBlock, /^\s*--bottom-bar-space:\s*0px;/m);
    assert.match(
      cssSource,
      /html\.has-bottom-bar\s*\{\s*--bottom-bar-space:\s*calc\(64px \+ var\(--safe-bottom\)\);\s*\}/
    );
  });
});

describe('мёртвые остатки старой навигации', () => {
  const srcRoot = path.join(here, '..');
  const self = fileURLToPath(import.meta.url);
  const textFiles: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(css|tsx?|jsx?|json)$/.test(entry.name) && full !== self) textFiles.push(full);
    }
  })(srcRoot);

  it('классов и значений старой плавающей навигации нет ни в src, ни в tailwind.config.js', () => {
    const dead = /nav-glass|mobile-nav|nav-tab-active|--nav-tab-|--nav-float-/;
    for (const file of textFiles) {
      const match = readFileSync(file, 'utf8').match(dead);
      assert.equal(match, null, `${path.relative(srcRoot, file)}: остался «${match?.[0]}»`);
    }
    assert.doesNotMatch(tailwindSource, dead);
  });

  it('живые разделитель и поле поиска шторки на месте', () => {
    assert.match(cssSource, /\.nav-divider\s*\{[^}]*var\(--nav-divider-color\)/);
    assert.match(cssSource, /\.nav-search-input\s*\{[^}]*var\(--nav-input-bg\)/);
    assert.match(cssSource, /\.nav-search-input:focus-within\s*\{[^}]*var\(--nav-input-focus-ring\)/);
  });
});
