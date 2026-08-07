// Живая подстройка темы: ручки в настройках оформления крутят те же токены,
// которые тема объявляет в своём блоке [data-theme=…] (см. :root в index.css).
// Значения кладутся инлайном на <html>, поэтому перебивают любое правило темы,
// и хранятся ОТДЕЛЬНО ПО ТЕМАМ — настраиваешь одну, остальные не трогаются.
//
// Смысл: подобрать шрифты, материал и ритм глазами, а потом забрать готовый
// CSS кнопкой «скопировать CSS» и вклеить в тему навсегда. Без перегенерации.
//
// Состоянием владеет ThemeContext (он же синхронизирует карту на аккаунт через
// ui-preferences), поэтому здесь только чистые функции: разбор, применение и
// сериализация. Своего хранилища у модуля нет намеренно — иначе настройки
// разъезжались бы между вкладкой и сервером.

/**
 * Шрифтовые стеки, реально загруженные в index.html. Список обязан совпадать
 * с тем, что грузится: гарнитура, которой нет, молча падает в системную, и
 * пользователь видит «ничего не произошло» вместо ошибки.
 */
export const FONT_STACKS = [
  {
    id: 'encode',
    label: 'Encode Sans',
    value: '"Encode Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: 'system',
    label: 'Системный',
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
  },
  {
    id: 'geologica',
    label: 'Geologica',
    value: "Geologica, 'Encode Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'barlow',
    label: 'Barlow',
    value: "Barlow, 'Encode Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'barlowCondensed',
    label: 'Barlow Condensed',
    value: "'Barlow Condensed', Barlow, 'Encode Sans', sans-serif",
  },
  {
    id: 'workSans',
    label: 'Work Sans',
    value: "'Work Sans', 'Encode Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'outfit',
    label: 'Outfit',
    value: "Outfit, 'Encode Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    id: 'serif',
    label: 'Merriweather',
    value: 'Merriweather, Georgia, Cambria, "Times New Roman", serif',
  },
  {
    id: 'mono',
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', Menlo, 'DejaVu Sans Mono', 'Liberation Mono', ui-monospace, monospace",
  },
] as const;

/** Выпадашки: ключ настройки → какой шрифтовой токен он подменяет. */
export const FONT_SLOTS = [
  { key: 'fontUi', cssVar: '--font-ui' },
  { key: 'fontDisplay', cssVar: '--font-display' },
  { key: 'fontSidebar', cssVar: '--font-sidebar' },
  { key: 'fontChat', cssVar: '--font-chat' },
  { key: 'fontMono', cssVar: '--font-mono' },
] as const;

/** Числовые ручки: ключ → какой токен крутит и в каких пределах. */
export const SLIDERS = [
  { key: 'radius', min: 0, max: 24, step: 1, unit: 'px' },
  { key: 'density', min: 0.7, max: 1.4, step: 0.05, unit: '' },
  { key: 'duration', min: 0, max: 500, step: 20, unit: 'ms' },
  { key: 'blur', min: 0, max: 40, step: 1, unit: 'px' },
  { key: 'panelAlpha', min: 0.2, max: 1, step: 0.02, unit: '' },
  { key: 'grain', min: 0, max: 0.2, step: 0.01, unit: '' },
  { key: 'tracking', min: -0.04, max: 0.2, step: 0.005, unit: 'em' },
] as const;

export type ThemeTweaks = {
  radius?: number;
  density?: number;
  duration?: number;
  blur?: number;
  panelAlpha?: number;
  grain?: number;
  tracking?: number;
  fontUi?: string;
  fontDisplay?: string;
  fontSidebar?: string;
  fontChat?: string;
  fontMono?: string;
  shadows?: boolean;
};

export type TweakMap = Record<string, ThemeTweaks>;

const NUMBER_KEYS = SLIDERS.map((slider) => slider.key);
const FONT_KEYS = FONT_SLOTS.map((slot) => slot.key);

/** Отбрасывает всё, чего панель не умеет крутить: карта приходит с сервера. */
const sanitize = (value: unknown): ThemeTweaks => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const tweaks: ThemeTweaks = {};
  NUMBER_KEYS.forEach((key) => {
    const entry = source[key];
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      tweaks[key] = entry;
    }
  });
  FONT_KEYS.forEach((key) => {
    const entry = source[key];
    if (typeof entry === 'string' && FONT_STACKS.some((stack) => stack.id === entry)) {
      tweaks[key] = entry;
    }
  });
  if (source.shadows === false) {
    tweaks.shadows = false;
  }
  return tweaks;
};

/** Разбирает карту твиков из строки (так она лежит в настройках аккаунта). */
export const parseTweakMap = (json: unknown): TweakMap => {
  if (typeof json !== 'string' || json.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const map: TweakMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([themeKey, value]) => {
      const tweaks = sanitize(value);
      if (Object.keys(tweaks).length > 0) {
        map[themeKey] = tweaks;
      }
    });
    return map;
  } catch {
    return {};
  }
};

const fontValue = (id?: string) => FONT_STACKS.find((stack) => stack.id === id)?.value;

/** Пары «токен → значение» для текущих настроек (пустая карта = ничего не трогаем). */
const cssVars = (tweaks: ThemeTweaks): Array<[string, string]> => {
  const vars: Array<[string, string]> = [];
  if (typeof tweaks.radius === 'number') vars.push(['--radius', `${tweaks.radius}px`]);
  if (typeof tweaks.density === 'number') vars.push(['--density', String(tweaks.density)]);
  if (typeof tweaks.duration === 'number') {
    vars.push(['--duration-fast', `${Math.round(tweaks.duration * 0.6)}ms`]);
    vars.push(['--duration-base', `${tweaks.duration}ms`]);
    vars.push(['--duration-slow', `${Math.round(tweaks.duration * 1.6)}ms`]);
  }
  // Размытие собирается целиком, а не только радиусом: в теме без материала
  // `--panel-blur` равен `none`, и один радиус там ничего бы не включил.
  if (typeof tweaks.blur === 'number') {
    vars.push(['--panel-blur-radius', `${tweaks.blur}px`]);
    vars.push([
      '--panel-blur',
      tweaks.blur > 0 ? 'blur(var(--panel-blur-radius)) saturate(var(--panel-saturate))' : 'none',
    ]);
  }
  if (typeof tweaks.panelAlpha === 'number') vars.push(['--panel-alpha', String(tweaks.panelAlpha)]);
  if (typeof tweaks.grain === 'number') vars.push(['--shell-grain-opacity', String(tweaks.grain)]);
  if (typeof tweaks.tracking === 'number') vars.push(['--tracking-ui', `${tweaks.tracking}em`]);

  FONT_SLOTS.forEach((slot) => {
    const stack = fontValue(tweaks[slot.key]);
    if (stack) vars.push([slot.cssVar, stack]);
  });

  if (tweaks.shadows === false) {
    vars.push(['--shadow-1', 'none'], ['--shadow-2', 'none'], ['--shadow-3', 'none']);
  }
  return vars;
};

/** Все токены, которые панель умеет трогать — нужны, чтобы честно снимать старые. */
const ALL_VARS = [
  '--radius', '--density', '--duration-fast', '--duration-base', '--duration-slow',
  '--panel-blur-radius', '--panel-blur', '--panel-alpha', '--shell-grain-opacity',
  '--tracking-ui', '--shadow-1', '--shadow-2', '--shadow-3',
  ...FONT_SLOTS.map((slot) => slot.cssVar),
];

/** Применить настройки темы к документу (снимая настройки предыдущей). */
export const applyTweaks = (themeKey: string, map: TweakMap): void => {
  const style = document.documentElement.style;
  ALL_VARS.forEach((name) => style.removeProperty(name));
  cssVars(map[themeKey] || {}).forEach(([name, value]) => style.setProperty(name, value));
};

/** Готовый блок для вклейки в index.css — то, ради чего панель и нужна. */
export const tweaksToCss = (themeKey: string, tweaks: ThemeTweaks): string => {
  const vars = cssVars(tweaks);
  if (vars.length === 0) {
    return `/* ${themeKey}: ничего не подкручено */`;
  }
  return [
    `[data-theme='${themeKey}'] {`,
    ...vars.map(([name, value]) => `  ${name}: ${value};`),
    '}',
  ].join('\n');
};
