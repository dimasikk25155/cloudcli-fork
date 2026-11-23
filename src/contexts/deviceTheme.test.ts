import assert from 'node:assert/strict';
import test from 'node:test';

import { readDeviceTheme, resolveAccountTheme } from './deviceTheme.js';

test('тема на устройстве есть — тема аккаунта не применяется', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: 'codex', accountTheme: 'glass' }), { apply: false });
});

test('на устройстве темы нет — берётся тема аккаунта, один раз', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: 'glass' }), {
    apply: true,
    theme: 'glass',
    neonVariant: null,
  });
});

test('убранный id в аккаунте подменяется, вариант «Неона» приходит с ним', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: '', accountTheme: 'synthwaveDrive' }), {
    apply: true,
    theme: 'neon',
    neonVariant: 'synthwave',
  });
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: 'gt' }), {
    apply: true,
    theme: 'ember',
    neonVariant: null,
  });
});

test('убранный id на устройстве — тоже «тема есть»: аккаунт её не перебивает', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: 'neonCity', accountTheme: 'glass' }), { apply: false });
});

test('в аккаунте темы нет или она не строка — применять нечего', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: undefined }), { apply: false });
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: '' }), { apply: false });
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: 5 }), { apply: false });
});

test('readDeviceTheme: appTheme, затем прежний ключ shaderVariant, пусто — null', () => {
  const store = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });
  assert.equal(readDeviceTheme(store({ appTheme: 'bio', shaderVariant: 'glass' })), 'bio');
  assert.equal(readDeviceTheme(store({ shaderVariant: 'glass' })), 'glass');
  assert.equal(readDeviceTheme(store({})), null);
  assert.equal(readDeviceTheme(store({ appTheme: '' })), null);
});

test('незнакомый id в аккаунте (не живой и не убранный) не применяется никогда', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: 'themeFromFuture' }), { apply: false });
  assert.deepEqual(resolveAccountTheme({ deviceTheme: 'glass', accountTheme: 'themeFromFuture' }), { apply: false });
});

test('живая тема аккаунта применяется как есть', () => {
  assert.deepEqual(resolveAccountTheme({ deviceTheme: null, accountTheme: 'bio' }), {
    apply: true,
    theme: 'bio',
    neonVariant: null,
  });
});
