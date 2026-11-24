import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DEFAULT_NEON_VARIANT,
  LEGACY_THEME_MAP,
  NEON_VARIANTS,
  isNeonVariant,
  migrateThemeId,
  neonVariantFile,
} from './themeMigration.js';

/**
 * Подмена убранных тем. Ожидания ниже — таблица «Темы: что было и что стало»
 * из спецификации, переписанная руками, а не взятая из кода под тестом.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const contextSource = readFileSync(path.join(here, 'ThemeContext.jsx'), 'utf8');
const indexHtmlSource = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

const SPEC_TABLE: Array<[legacy: string, theme: string, neonVariant: string | null]> = [
  ['neonCity', 'neon', 'city'],
  ['synthwaveDrive', 'neon', 'synthwave'],
  ['nebulaFlow', 'neon', 'nebula'],
  ['missionControl', 'neon', 'mission'],
  ['bento3d', 'neon', 'bento'],
  ['liquidChrome', 'neon', 'chrome'],
  ['zenParticles', 'neon', 'zen'],
  ['kineticType', 'neon', 'kinetic'],
  ['gt', 'ember', null],
  ['claude', 'ember', null],
  ['editorial', 'glass', null],
];

const SPEC_VARIANTS: Array<[id: string, label: string, legacyTheme: string]> = [
  ['city', 'Голубой', 'neonCity'],
  ['synthwave', 'Розовый', 'synthwaveDrive'],
  ['nebula', 'Мятный', 'nebulaFlow'],
  ['mission', 'Синий', 'missionControl'],
  ['bento', 'Зелёный', 'bento3d'],
  ['chrome', 'Сиреневый', 'liquidChrome'],
  ['zen', 'Янтарный', 'zenParticles'],
  ['kinetic', 'Лаймовый', 'kineticType'],
];

const CURRENT_THEMES = ['ember', 'codex', 'bio', 'neon', 'glass', 'claudeLight'];

describe('подмена убранных тем', () => {
  it('каждая из 11 убранных тем переходит в ближайшую по таблице', () => {
    assert.equal(Object.keys(LEGACY_THEME_MAP).length, SPEC_TABLE.length);
    for (const [legacy, theme, neonVariant] of SPEC_TABLE) {
      const result = migrateThemeId(legacy);
      assert.equal(result.theme, theme, `${legacy} → ${theme}`);
      assert.equal(result.migrated, true, `${legacy}: подмена должна быть отмечена`);
      if (neonVariant) {
        assert.equal(result.neonVariant, neonVariant, `${legacy} → вариант ${neonVariant}`);
      } else {
        assert.equal(result.neonVariant, null, `${legacy}: варианта «Неона» быть не должно`);
      }
    }
  });

  it('убранная тема никогда не превращается в «Светлую Claude»', () => {
    for (const [legacy] of SPEC_TABLE) {
      assert.notEqual(migrateThemeId(legacy).theme, 'claudeLight', legacy);
    }
  });

  it('живая тема остаётся собой и не помечается подменой', () => {
    for (const theme of CURRENT_THEMES) {
      assert.deepEqual(migrateThemeId(theme), { theme, neonVariant: null, migrated: false });
    }
  });

  it('неизвестный, пустой и чужеродный id → оранжевая', () => {
    for (const junk of ['aether', 'default', '', null, undefined, 42, 'constructor', '__proto__', 'toString']) {
      const result = migrateThemeId(junk as never);
      assert.equal(result.theme, 'ember', `id ${String(junk)}`);
      assert.equal(result.neonVariant, null);
      assert.equal(result.migrated, true);
    }
  });

  it('список тем модуля совпадает с THEMES из ThemeContext', () => {
    const match = contextSource.match(/export const THEMES = \[([\s\S]*?)\]/);
    assert.ok(match, 'не нашёл THEMES в ThemeContext.jsx');
    const themes = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    assert.deepEqual(themes, CURRENT_THEMES);
    // Ни один убранный id не остался в реестре.
    for (const [legacy] of SPEC_TABLE) {
      assert.ok(!themes.includes(legacy), `${legacy} всё ещё в THEMES`);
    }
  });
});

describe('варианты «Неона»', () => {
  it('восемь вариантов: id, подпись, прежняя тема и её фото', () => {
    assert.deepEqual(
      NEON_VARIANTS.map((variant) => [variant.id, variant.label, variant.legacyTheme]),
      SPEC_VARIANTS,
    );
    for (const variant of NEON_VARIANTS) {
      assert.equal(variant.file, `${variant.legacyTheme}.jpg`);
    }
  });

  it('фото каждого варианта лежит в public/theme-bg под прежним именем', () => {
    for (const [, , legacyTheme] of SPEC_VARIANTS) {
      const file = path.join(repoRoot, 'public', 'theme-bg', `${legacyTheme}.jpg`);
      assert.ok(existsSync(file), `нет файла ${file}`);
    }
    // Запасные фото «Лаймовой» остаются файлами, хотя в выбор не входят.
    for (const spare of ['chrome', 'kinetic', 'slab', 'wireframe']) {
      assert.ok(existsSync(path.join(repoRoot, 'public', 'theme-bg', `kineticType-${spare}.jpg`)));
    }
  });

  it('по умолчанию — Голубой; чужой id откатывается на него', () => {
    assert.equal(DEFAULT_NEON_VARIANT, 'city');
    assert.equal(neonVariantFile('zen'), '/theme-bg/zenParticles.jpg');
    assert.equal(neonVariantFile('kinetic'), '/theme-bg/kineticType.jpg');
    assert.equal(neonVariantFile('nope'), '/theme-bg/neonCity.jpg');
    assert.equal(neonVariantFile(undefined), '/theme-bg/neonCity.jpg');
    assert.equal(isNeonVariant('synthwave'), true);
    assert.equal(isNeonVariant('neonCity'), false);
    assert.equal(isNeonVariant('constructor'), false);
    assert.equal(isNeonVariant(null), false);
  });
});

/**
 * Скрипт до первой отрисовки не может импортировать модуль, поэтому держит
 * копии таблиц. Разъедутся копии — человек с убранной темой увидит вспышку
 * пустого оформления или чужую тему. Здесь копии сверяются со своим источником.
 */
describe('скрипт до первой отрисовки (index.html)', () => {
  const bootScript = (() => {
    const match = indexHtmlSource.match(/<script>\s*\(function \(\) \{[\s\S]*?var LIGHT_THEMES[\s\S]*?<\/script>/);
    assert.ok(match, 'не нашёл inline-скрипт темы в index.html');
    return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  })();

  it('таблица подмены — копия LEGACY_THEME_MAP', () => {
    const match = bootScript.match(/var LEGACY_THEME_MAP = \{([\s\S]*?)\};/);
    assert.ok(match, 'в скрипте нет LEGACY_THEME_MAP');
    const boot: Record<string, { theme: string; neonVariant?: string }> = {};
    for (const entry of match[1].matchAll(/([A-Za-z0-9]+):\s*\['([^']+)'(?:,\s*'([^']+)')?\]/g)) {
      boot[entry[1]] = entry[3] ? { theme: entry[2], neonVariant: entry[3] } : { theme: entry[2] };
    }
    assert.deepEqual(boot, { ...LEGACY_THEME_MAP });
  });

  it('список живых тем — копия THEMES', () => {
    const match = bootScript.match(/var THEMES = \[([^\]]*)\]/);
    assert.ok(match, 'в скрипте нет THEMES');
    const boot = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    assert.deepEqual(boot, CURRENT_THEMES);
  });

  it('список вариантов «Неона» — копия NEON_VARIANTS', () => {
    const match = bootScript.match(/var NEON_VARIANTS = \[([^\]]*)\]/);
    assert.ok(match, 'в скрипте нет NEON_VARIANTS');
    const boot = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    assert.deepEqual(boot, NEON_VARIANTS.map((variant) => variant.id));
  });

  /** Запускает скрипт на подставном документе и возвращает, что он оставил. */
  function boot(stored: Record<string, string>) {
    const storage = new Map(Object.entries(stored));
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    const metas: Record<string, { content: string }> = {
      'meta[name="theme-color"]': { content: '#ffffff' },
      'meta[name="apple-mobile-web-app-status-bar-style"]': { content: 'black-translucent' },
    };
    const root = {
      style: { backgroundColor: '' },
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
      classList: {
        toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)),
      },
    };
    const document = {
      documentElement: root,
      querySelector: (selector: string) => {
        const meta = metas[selector];
        return meta ? { setAttribute: (_name: string, value: string) => void (meta.content = value) } : null;
      },
    };
    const localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
    };
    // eslint-disable-next-line no-new-func
    new Function('document', 'localStorage', bootScript)(document, localStorage);
    return {
      theme: attributes.get('data-theme'),
      variant: attributes.get('data-theme-variant'),
      dark: classes.has('dark'),
      background: root.style.backgroundColor,
      statusBar: metas['meta[name="apple-mobile-web-app-status-bar-style"]'].content,
      storage: Object.fromEntries(storage),
    };
  }

  it('убранная тема подменяется до монтирования React и переписывается на устройстве', () => {
    for (const [legacy, theme, neonVariant] of SPEC_TABLE) {
      const result = boot({ appTheme: legacy, appThemeColor: '#123456' });
      assert.equal(result.theme, theme, `${legacy}: data-theme`);
      assert.equal(result.storage.appTheme, theme, `${legacy}: запись на устройстве`);
      assert.equal(result.variant, neonVariant ?? undefined, `${legacy}: data-theme-variant`);
      if (neonVariant) {
        assert.equal(result.storage.neonVariant, neonVariant);
      }
      // Сохранённый цвет окна принадлежал убранной теме — им красить нельзя.
      assert.notEqual(result.background, '#123456', `${legacy}: цвет прежней темы`);
      assert.equal(result.dark, theme !== 'glass');
    }
  });

  it('бежевая светлая остаётся светлой: без .dark и со светлым статус-баром', () => {
    const result = boot({ appTheme: 'editorial' });
    assert.equal(result.theme, 'glass');
    assert.equal(result.dark, false);
    assert.equal(result.statusBar, 'default');
  });

  it('неизвестный id → оранжевая; пустое устройство → оранжевая без записи темы', () => {
    const unknown = boot({ appTheme: 'aether' });
    assert.equal(unknown.theme, 'ember');
    assert.equal(unknown.storage.appTheme, 'ember');
    assert.equal(unknown.dark, true);

    const fresh = boot({});
    assert.equal(fresh.theme, 'ember');
    assert.equal(fresh.variant, undefined);
    // Тему аккаунта новое устройство берёт позже — запись здесь её опередила бы.
    assert.equal('appTheme' in fresh.storage, false);
  });

  it('«Неон» получает сохранённый вариант, остальные темы — без атрибута варианта', () => {
    assert.equal(boot({ appTheme: 'neon', neonVariant: 'zen' }).variant, 'zen');
    assert.equal(boot({ appTheme: 'neon' }).variant, 'city');
    assert.equal(boot({ appTheme: 'neon', neonVariant: 'nope' }).variant, 'city');
    assert.equal(boot({ appTheme: 'ember', neonVariant: 'zen' }).variant, undefined);
    const kept = boot({ appTheme: 'glass', appThemeColor: '#abcdef' });
    assert.equal(kept.theme, 'glass');
    assert.equal(kept.background, '#abcdef');
  });

  it('старый ключ shaderVariant тоже проходит подмену', () => {
    const result = boot({ shaderVariant: 'synthwaveDrive' });
    assert.equal(result.theme, 'neon');
    assert.equal(result.variant, 'synthwave');
  });
});
