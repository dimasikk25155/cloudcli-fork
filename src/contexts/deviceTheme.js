// Тема — своя на каждом устройстве. Чистые функции: ни DOM, ни React, ни сети.
//
// Истина — localStorage устройства. Ответ сервера (`GET /api/settings/ui-preferences`)
// даёт только стартовую тему для устройства, на котором своей ещё нет.
//
// «Своей ещё нет» — это не «ключ `appTheme` пуст»: ThemeProvider смонтирован
// выше экрана входа и первым же рендером записывает показанную тему, то есть
// тему по умолчанию. Запрос настроек до входа не проходит, а после входа ключ
// уже занят. Поэтому запись, которую сделал сам код, помечается
// (`appThemeOrigin = default`), и такая тема своей не считается, пока её не
// выбрал человек или не пришёл ответ аккаунта.

import { LEGACY_THEME_MAP, migrateThemeId } from './themeMigration.js';

/** Пометка «тему записал код, а не человек». Нет ключа — тема своя. */
export const DEVICE_THEME_ORIGIN_KEY = 'appThemeOrigin';
const ORIGIN_DEFAULT = 'default';

/** Прежний ключ `shaderVariant` читается так же, как в начальном состоянии темы. */
const readStoredTheme = (storage) =>
  storage.getItem('appTheme') || storage.getItem('shaderVariant') || null;

/**
 * Своя тема устройства или null. Тема по умолчанию, которую записал сам код
 * (см. writeDeviceTheme), своей не считается.
 * Устройства, жившие до этой пометки, хранят `appTheme` без неё — это своя тема.
 */
export const readDeviceTheme = (storage) =>
  storage.getItem(DEVICE_THEME_ORIGIN_KEY) === ORIGIN_DEFAULT ? null : readStoredTheme(storage);

/**
 * Запись показанной темы на устройство — её делает ThemeProvider при каждой
 * смене темы и при первом рендере. Первая запись на пустое устройство — это
 * тема по умолчанию, её никто не выбирал: она помечается.
 */
export const writeDeviceTheme = (storage, theme) => {
  if (readStoredTheme(storage) === null) {
    storage.setItem(DEVICE_THEME_ORIGIN_KEY, ORIGIN_DEFAULT);
  }
  storage.setItem('appTheme', theme);
};

/** Тема устройства теперь своя: её выбрал человек или один раз дал аккаунт. */
export const claimDeviceTheme = (storage) => {
  storage.removeItem(DEVICE_THEME_ORIGIN_KEY);
};

/**
 * Применять ли тему из ответа сервера.
 *
 * - на устройстве тема есть (даже убранная — её подменит migrateThemeId) → нет;
 * - нет, а в аккаунте строка → да, после подмены убранного id; вариант «Неона»
 *   приходит с подменой фото-темы;
 * - в аккаунте ничего пригодного или id незнакомый (ни живой, ни убранный) → нет.
 */
export const resolveAccountTheme = ({ deviceTheme, accountTheme }) => {
  if (deviceTheme) {
    return { apply: false };
  }
  if (typeof accountTheme !== 'string' || !accountTheme) {
    return { apply: false };
  }
  const migrated = migrateThemeId(accountTheme);
  // Незнакомый id (тема из будущей версии, мусор) migrateThemeId отправляет в
  // «Оранжевую»; на новом устройстве это стартовая тема по умолчанию и так.
  // Применять такое нельзя: аккаунт не должен ничего менять без понятного id.
  if (migrated.migrated && !Object.hasOwn(LEGACY_THEME_MAP, accountTheme)) {
    return { apply: false };
  }
  return { apply: true, theme: migrated.theme, neonVariant: migrated.neonVariant };
};

/**
 * Ответ аккаунта пришёл (после входа или при запуске с живым входом): решает,
 * брать ли его тему, и закрывает вопрос — устройство берёт тему аккаунта один
 * раз. Дальше оно живёт своей, даже если в аккаунте темы не оказалось.
 */
export const takeAccountTheme = (storage, accountTheme) => {
  const result = resolveAccountTheme({ deviceTheme: readDeviceTheme(storage), accountTheme });
  claimDeviceTheme(storage);
  return result;
};
