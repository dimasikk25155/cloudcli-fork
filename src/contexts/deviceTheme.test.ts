import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  claimDeviceTheme,
  readDeviceTheme,
  resolveAccountTheme,
  takeAccountTheme,
  writeDeviceTheme,
} from './deviceTheme.js';

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

// --- Новое устройство и вход через форму (ревью ветки, история 19) ---------
//
// ThemeProvider смонтирован до входа: первый же рендер записывает на устройство
// тему по умолчанию, а запрос настроек без токена не проходит. Ниже — тот же
// порядок шагов на хранилище в памяти, теми же функциями, что зовёт провайдер.

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
  };
};

/** Запуск приложения: провайдер читает тему устройства и первым рендером записывает показанную. */
const launch = (storage: ReturnType<typeof memoryStorage>) => {
  const theme = readDeviceTheme(storage) ?? 'ember';
  writeDeviceTheme(storage, theme);
  return theme;
};

/** Человек выбрал тему в настройках этого устройства. */
const choose = (storage: ReturnType<typeof memoryStorage>, theme: string) => {
  claimDeviceTheme(storage);
  writeDeviceTheme(storage, theme);
};

test('новое устройство: после входа через форму берётся тема аккаунта', () => {
  const storage = memoryStorage();
  // Экран входа: токена нет, запрос настроек аккаунта не прошёл.
  assert.equal(launch(storage), 'ember');
  // Вошёл — настройки аккаунта перечитаны.
  assert.deepEqual(takeAccountTheme(storage, 'glass'), { apply: true, theme: 'glass', neonVariant: null });
});

test('новое устройство: ответ аккаунта не пришёл — тема берётся при следующем запуске', () => {
  const storage = memoryStorage();
  launch(storage);
  // Второй запуск: тему по умолчанию записал код, человек её не выбирал.
  assert.equal(launch(storage), 'ember');
  assert.equal(readDeviceTheme(storage), null);
  assert.deepEqual(takeAccountTheme(storage, 'synthwaveDrive'), { apply: true, theme: 'neon', neonVariant: 'synthwave' });
});

test('тему аккаунта устройство берёт один раз, дальше живёт своей', () => {
  const storage = memoryStorage();
  launch(storage);
  assert.equal(takeAccountTheme(storage, 'glass').apply, true);
  writeDeviceTheme(storage, 'glass');
  // На другом устройстве выбрали «Графит» — стартовая тема аккаунта сменилась.
  assert.deepEqual(takeAccountTheme(storage, 'codex'), { apply: false });
  assert.equal(launch(storage), 'glass');
  assert.deepEqual(takeAccountTheme(storage, 'codex'), { apply: false });
});

test('тема, выбранная человеком на устройстве, темой аккаунта не перезаписывается', () => {
  const storage = memoryStorage();
  launch(storage);
  choose(storage, 'codex');
  assert.deepEqual(takeAccountTheme(storage, 'glass'), { apply: false });
  assert.equal(launch(storage), 'codex');
  // Выбрал ту же, что стояла по умолчанию, — это тоже выбор.
  const other = memoryStorage();
  launch(other);
  choose(other, 'ember');
  assert.deepEqual(takeAccountTheme(other, 'glass'), { apply: false });
  assert.equal(readDeviceTheme(other), 'ember');
});

test('устройство с темой, сохранённой до этой сборки, остаётся на своей', () => {
  const storage = memoryStorage({ appTheme: 'ember' });
  assert.equal(launch(storage), 'ember');
  assert.deepEqual(takeAccountTheme(storage, 'glass'), { apply: false });
  const legacy = memoryStorage({ shaderVariant: 'bio' });
  assert.equal(launch(legacy), 'bio');
  assert.deepEqual(takeAccountTheme(legacy, 'glass'), { apply: false });
});

test('в аккаунте темы нет или id незнакомый: устройство остаётся на своей и больше не ждёт', () => {
  for (const accountTheme of [undefined, 'themeFromFuture']) {
    const storage = memoryStorage();
    launch(storage);
    assert.deepEqual(takeAccountTheme(storage, accountTheme), { apply: false });
    // Первый ответ аккаунта закрыл вопрос: позже чужой выбор сюда не приедет.
    assert.deepEqual(takeAccountTheme(storage, 'glass'), { apply: false });
    assert.equal(readDeviceTheme(storage), 'ember');
  }
});

test('подмена убранной темы аккаунта не ведёт на claudeLight', () => {
  for (const removed of ['gt', 'claude', 'editorial', 'neonCity', 'kineticType']) {
    const storage = memoryStorage();
    launch(storage);
    const taken = takeAccountTheme(storage, removed);
    assert.equal(taken.apply, true, removed);
    assert.notEqual(taken.apply && taken.theme, 'claudeLight', removed);
  }
});

// Провайдер и хранилище под node не поднять (нужны DOM и эффекты), поэтому
// связка «вход → перечитать настройки аккаунта» сторожится по исходникам.
test('ThemeProvider узнаёт о входе и перечитывает настройки аккаунта; тему на устройство пишет только через deviceTheme', () => {
  const provider = readFileSync(new URL('./ThemeContext.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  // Вход живёт в AuthProvider: провайдер темы должен стоять под ним, иначе
  // смену токена ему не увидеть.
  const authAt = app.indexOf('<AuthProvider>');
  const themeAt = app.indexOf('<ThemeProvider>');
  assert.ok(authAt >= 0 && themeAt > authAt, 'ThemeProvider стоит выше AuthProvider — о входе он не узнает');
  assert.match(provider, /const \{ token \} = useAuth\(\);/);
  // Запрос настроек аккаунта повторяется при смене токена (вход через форму).
  const load = provider.match(
    /useEffect\(\(\) => \{\n    let cancelled = false;\n    authenticatedFetch\('\/api\/settings\/ui-preferences'\)([\s\S]*?)\n  \}, \[([^\]]*)\]\);/,
  );
  assert.ok(load, 'не нашёл эффект, читающий настройки аккаунта');
  assert.equal(load[2].trim(), 'token', 'настройки аккаунта читаются один раз при монтировании, а не после входа');
  assert.match(load[1], /takeAccountTheme\(localStorage, savedTheme\)/);
  // Остальные настройки аккаунта применяются тем же ответом, как раньше.
  for (const setter of ['setShaderEnabledRaw', 'setUiScaleRaw', 'setThemeBackgroundsRaw', 'setThemeTweaksRaw', 'setCustomBackgroundRaw']) {
    assert.ok(load[1].includes(`${setter}(`), `ответ аккаунта больше не применяет ${setter}`);
  }
  // Запись темы на устройство — одна, с пометкой «записал код».
  assert.doesNotMatch(provider, /localStorage\.setItem\('appTheme'/);
  assert.match(provider, /writeDeviceTheme\(localStorage, theme\);/);
  // Выбор человека: тема становится своей и уходит в аккаунт стартовой.
  const setTheme = provider.match(/const setTheme = \(next\) => \{([\s\S]*?)\n  \};/);
  assert.ok(setTheme, 'не нашёл setTheme');
  assert.match(setTheme[1], /claimDeviceTheme\(localStorage\);/);
  assert.match(setTheme[1], /method: 'PUT',\s*body: JSON\.stringify\(\{ theme: next \}\)/);
});
