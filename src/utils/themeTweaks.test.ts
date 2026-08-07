import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

// Минимальная заглушка браузера: модуль трогает только documentElement.style.
// Своего хранилища у него больше нет — картой владеет ThemeContext.
const props = new Map<string, string>();

(globalThis as unknown as { document: Document }).document = {
  documentElement: {
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => void props.delete(name),
      getPropertyValue: (name: string) => props.get(name) ?? '',
    },
  },
} as unknown as Document;

// Что объявляет САМА тема. Инлайновые твики (`props`) обязаны перебивать эти
// значения в приложении и НЕ попадать в чтение значений темы.
const themeVars = new Map<string, string>();

(globalThis as unknown as { getComputedStyle: typeof getComputedStyle }).getComputedStyle = (() => ({
  fontSize: '16px',
  getPropertyValue: (name: string) => props.get(name) ?? themeVars.get(name) ?? '',
})) as unknown as typeof getComputedStyle;

const { applyTweaks, parseTweakMap, readThemeDefaults, tweaksToCss } = await import('./themeTweaks.js');

describe('themeTweaks', () => {
  beforeEach(() => {
    props.clear();
  });

  it('держит настройки отдельно по темам', () => {
    const map = parseTweakMap(JSON.stringify({ kineticType: { radius: 2 }, claude: { radius: 14 } }));

    applyTweaks('kineticType', map);
    assert.equal(props.get('--radius'), '2px');

    applyTweaks('claude', map);
    assert.equal(props.get('--radius'), '14px');
  });

  it('снимает токены предыдущей темы при переключении', () => {
    const map = parseTweakMap(JSON.stringify({ claude: { radius: 14, density: 1.2 } }));
    applyTweaks('claude', map);
    assert.equal(props.get('--radius'), '14px');
    assert.equal(props.get('--density'), '1.2');

    // У этой темы ничего не подкручено — на документе не должно остаться следов.
    applyTweaks('neonCity', map);
    assert.equal(props.has('--radius'), false);
    assert.equal(props.has('--density'), false);
  });

  it('одна ручка скорости тянет всю тройку длительностей', () => {
    applyTweaks('claude', { claude: { duration: 200 } });

    assert.equal(props.get('--duration-fast'), '120ms');
    assert.equal(props.get('--duration-base'), '200ms');
    assert.equal(props.get('--duration-slow'), '320ms');
  });

  it('выключенные тени обнуляют все три токена', () => {
    applyTweaks('claude', { claude: { shadows: false } });

    assert.equal(props.get('--shadow-1'), 'none');
    assert.equal(props.get('--shadow-3'), 'none');
  });

  it('размытие собирается целиком, а не одним радиусом', () => {
    // В теме без материала --panel-blur равен none: один радиус там ничего бы
    // не включил, поэтому ручка обязана задавать и саму функцию.
    applyTweaks('claude', { claude: { blur: 18 } });
    assert.equal(props.get('--panel-blur-radius'), '18px');
    assert.equal(props.get('--panel-blur'), 'blur(var(--panel-blur-radius)) saturate(var(--panel-saturate))');

    applyTweaks('claude', { claude: { blur: 0 } });
    assert.equal(props.get('--panel-blur'), 'none');
  });

  it('крутит материал и разрядку', () => {
    applyTweaks('glass', { glass: { panelAlpha: 0.5, grain: 0.08, tracking: 0.02 } });

    assert.equal(props.get('--panel-alpha'), '0.5');
    assert.equal(props.get('--shell-grain-opacity'), '0.08');
    assert.equal(props.get('--tracking-ui'), '0.02em');
  });

  it('раскладывает все пять шрифтовых слотов по своим токенам', () => {
    applyTweaks('gt', {
      gt: {
        fontUi: 'barlow',
        fontDisplay: 'barlowCondensed',
        fontSidebar: 'encode',
        fontChat: 'serif',
        fontMono: 'mono',
      },
    });

    assert.match(props.get('--font-ui') || '', /Barlow/);
    assert.match(props.get('--font-display') || '', /Barlow Condensed/);
    assert.match(props.get('--font-sidebar') || '', /Encode Sans/);
    assert.match(props.get('--font-chat') || '', /Merriweather/);
    assert.match(props.get('--font-mono') || '', /JetBrains Mono/);
  });

  it('отдаёт CSS, готовый к вклейке в тему', () => {
    const css = tweaksToCss('kineticType', { radius: 2, density: 0.95 });

    assert.equal(css.startsWith("[data-theme='kineticType'] {"), true);
    assert.equal(css.includes('  --radius: 2px;'), true);
    assert.equal(css.includes('  --density: 0.95;'), true);
    assert.equal(css.trimEnd().endsWith('}'), true);
  });

  it('неизвестный шрифт не попадает в токены', () => {
    applyTweaks('claude', { claude: { fontUi: 'no-such-stack' } as never });

    assert.equal(props.has('--font-ui'), false);
  });

  it('карта с сервера чистится от чужих ключей и битого JSON', () => {
    const map = parseTweakMap(JSON.stringify({
      glass: { radius: 12, evil: 'drop me', fontUi: 'no-such-stack' },
      empty: {},
    }));

    assert.deepEqual(map, { glass: { radius: 12 } });
    assert.deepEqual(parseTweakMap('не json'), {});
    assert.deepEqual(parseTweakMap(undefined), {});
  });

  describe('значения самой темы', () => {
    beforeEach(() => {
      themeVars.clear();
      themeVars.set('--radius', '1rem');
      themeVars.set('--density', '1.05');
      themeVars.set('--duration-base', '260ms');
      themeVars.set('--panel-blur-radius', '34px');
      themeVars.set('--panel-alpha', '0.42');
      themeVars.set('--tracking-ui', '-0.01em');
      themeVars.set('--shadow-1', '0 2px 8px rgba(0,0,0,.06)');
    });

    it('переводит rem в пиксели и читает единицы', () => {
      const defaults = readThemeDefaults();

      assert.equal(defaults.radius, 16);
      assert.equal(defaults.density, 1.05);
      assert.equal(defaults.duration, 260);
      assert.equal(defaults.blur, 34);
      assert.equal(defaults.panelAlpha, 0.42);
      assert.equal(defaults.shadows, true);
    });

    it('разрядка не делится на размер шрифта — em тут считается от текста', () => {
      assert.equal(readThemeDefaults().tracking, -0.01);
    });

    it('инлайновый твик не подменяет значение темы и остаётся на месте', () => {
      applyTweaks('glass', { glass: { radius: 4 } });
      assert.equal(props.get('--radius'), '4px');

      // Ползунку нужна точка отсчёта темы (16px), а не текущий твик (4px).
      assert.equal(readThemeDefaults().radius, 16);
      // И сам твик обязан пережить чтение: иначе экран моргнёт темой.
      assert.equal(props.get('--radius'), '4px');
    });

    it('отсутствующие и none-значения читаются нулём, а тени — выключенными', () => {
      themeVars.set('--tracking-ui', 'normal');
      themeVars.set('--shadow-1', 'none');
      themeVars.delete('--shell-grain-opacity');

      const defaults = readThemeDefaults();

      assert.equal(defaults.tracking, 0);
      assert.equal(defaults.grain, 0);
      assert.equal(defaults.shadows, false);
    });
  });
});
