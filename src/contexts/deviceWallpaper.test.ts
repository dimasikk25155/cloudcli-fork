import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deviceOwnsWallpaper, takeAccountWallpaper } from './deviceWallpaper.js';

const memoryStorage = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key: string) => (map.has(key) ? map.get(key)! : null) };
};

test('фон уже выбран на устройстве — его выбор свой', () => {
  assert.equal(deviceOwnsWallpaper(memoryStorage({ shaderBg: 'off' })), true);
  assert.equal(deviceOwnsWallpaper(memoryStorage({ shaderBg: 'on' })), true);
});

test('новое устройство — своего выбора нет', () => {
  assert.equal(deviceOwnsWallpaper(memoryStorage()), false);
});

test('айфон выключил фон, а в аккаунте «вкл» с Windows — айфон остаётся выключенным', () => {
  assert.deepEqual(
    takeAccountWallpaper({ deviceOwned: true, accountEnabled: true, accountBackgrounds: { ember: 'show' } }),
    { applyEnabled: false, applyBackgrounds: false }
  );
});

test('новое устройство берёт фон и ролик из аккаунта', () => {
  assert.deepEqual(
    takeAccountWallpaper({ deviceOwned: false, accountEnabled: false, accountBackgrounds: { ember: 'show' } }),
    { applyEnabled: true, applyBackgrounds: true }
  );
});

test('новое устройство, в аккаунте пусто — остаётся как есть', () => {
  assert.deepEqual(
    takeAccountWallpaper({ deviceOwned: false, accountEnabled: undefined, accountBackgrounds: {} }),
    { applyEnabled: false, applyBackgrounds: false }
  );
});

test('ThemeProvider берёт фон аккаунта только через takeAccountWallpaper', () => {
  const source = readFileSync(new URL('./ThemeContext.jsx', import.meta.url), 'utf8');
  assert.match(source, /takeAccountWallpaper\(\{/);
  // Прямого применения флага из ответа сервера мимо правила быть не должно.
  assert.doesNotMatch(source, /typeof savedShaderEnabled === 'boolean'/);
  assert.match(source, /if \(wallpaper\.applyEnabled\) \{\s*setShaderEnabledRaw\(savedShaderEnabled\);/);
});
