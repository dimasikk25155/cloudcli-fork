// Тема — своя на каждом устройстве. Чистые функции: ни DOM, ни React, ни сети.
//
// Истина — localStorage устройства. Ответ сервера (`GET /api/settings/ui-preferences`)
// даёт только стартовую тему для устройства, на котором своей ещё нет.

import { LEGACY_THEME_MAP, migrateThemeId } from './themeMigration.js';

/**
 * Тема, сохранённая на устройстве, или null. Читается ДО первой записи
 * ThemeProvider: его эффект кладёт `appTheme` при первом же рендере, и после
 * этого «есть ли тема» уже не узнать.
 * Прежний ключ `shaderVariant` читается так же, как в начальном состоянии темы.
 */
export const readDeviceTheme = (storage) =>
  storage.getItem('appTheme') || storage.getItem('shaderVariant') || null;

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
