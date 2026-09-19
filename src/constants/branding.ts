/**
 * Имя продукта — ОДИН источник правды на весь фронт.
 *
 * Раньше оно было размазано: заголовок вкладки, экраны логина и шапка сайдбара
 * держали свои копии, часть из них — с брендом апстрима ("Claude CLI"), который
 * вылезал во вкладке браузера и на первом экране установки. Ребрендинг под
 * клиента = правка этой строки (плюс index.html и manifest), а не десяти файлов.
 */
export const APP_NAME = 'Neo3 Agent System';

/** Публичный гайд по экранам — живёт на витрине, не на сервере клиента. */
export const GUIDE_URL = 'https://cli.neo3.ru/guide';

export const CLOUDCLI_WORDMARK_FONT_FAMILY =
  'ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji';
