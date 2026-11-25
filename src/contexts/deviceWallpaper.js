// Живые обои — свои на каждом устройстве, как тема (deviceTheme.js).
// Чистые функции: ни DOM, ни React, ни сети.
//
// Дима 25.11: «чтобы на айфоне можно было выключать фон, не привязанно к той,
// которая включена на винде» — ролик гоняет железо, тянет его только Windows.
//
// Истина — localStorage устройства: `shaderBg` (вкл/выкл) и `themeBackgrounds`
// (какой ролик в какой теме). Ответ сервера даёт их только устройству, где
// фона ещё не было: ThemeProvider записывает `shaderBg` при первом же рендере,
// поэтому «свой ли фон» решается по состоянию ДО первого рендера.

/** Ключ флага «фон включён» (историческое имя — фон когда-то был шейдером). */
export const DEVICE_WALLPAPER_KEY = 'shaderBg';

/** Есть ли на устройстве свой выбор фона. Читать до первой записи провайдера. */
export const deviceOwnsWallpaper = (storage) => storage.getItem(DEVICE_WALLPAPER_KEY) !== null;

/**
 * Что взять из настроек аккаунта.
 * - у устройства свой выбор → ничего: выключатель на айфоне не трогает Windows и наоборот;
 * - устройство новое → флаг (если он булев) и карту роликов (если не пустая).
 */
export const takeAccountWallpaper = ({ deviceOwned, accountEnabled, accountBackgrounds }) => {
  if (deviceOwned) {
    return { applyEnabled: false, applyBackgrounds: false };
  }
  return {
    applyEnabled: typeof accountEnabled === 'boolean',
    applyBackgrounds: Boolean(accountBackgrounds) && Object.keys(accountBackgrounds).length > 0,
  };
};
