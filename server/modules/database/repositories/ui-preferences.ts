/**
 * UI preferences repository.
 *
 * Stores per-user appearance/behavior toggles (theme, shader background,
 * composer/sidebar toggles) as a single JSON blob, so a choice made on one
 * device shows up on every other device instead of being stuck in that one
 * browser's localStorage. Only a fixed allow-list of keys is persisted —
 * this endpoint is not a generic key/value store for arbitrary client state.
 */

import { getConnection } from '@/modules/database/connection.js';

export type UiPreferenceValue = string | number | boolean;
export type UiPreferences = Record<string, UiPreferenceValue>;

const ALLOWED_KEYS = new Set([
  'theme',
  'shaderEnabled',
  // JSON-строка вида {"kineticType":"kinetic"} — какая картинка выбрана внутри
  // темы. Хранится строкой, т.к. здесь только плоские значения.
  'themeBackgrounds',
  // Загружена ли своя картинка фона. Сам файл лежит на диске
  // (`~/.cloudcli/theme-bg/<userId>.webp`), здесь только флаг — чтобы клиент
  // знал, рисовать ли её, не дёргая картинку ради проверки существования.
  'customBackground',
  // JSON-строка вида {"glass":{"radius":16,"fontUi":"outfit"}} — ручная
  // подстройка темы из панели твиков, по темам. Строкой по той же причине,
  // что и themeBackgrounds: здесь хранятся только плоские значения.
  'themeTweaks',
  'uiScale',
  'showRawParameters',
  'showThinking',
  'sendByCtrlEnter',
  'sendByDoubleEnter',
  'sidebarVisible',
  'voiceEnabled',
]);

function isPreferenceValue(value: unknown): value is UiPreferenceValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalize(value: unknown): UiPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entryValue]) => ALLOWED_KEYS.has(key) && isPreferenceValue(entryValue));

  return Object.fromEntries(entries) as UiPreferences;
}

function parseJson(json: string): UiPreferences {
  try {
    return normalize(JSON.parse(json));
  } catch {
    return {};
  }
}

export const uiPreferencesDb = {
  /** Returns the stored preferences for a user, or an empty object if unset. */
  getUiPreferences(userId: number): UiPreferences {
    const db = getConnection();
    const row = db
      .prepare('SELECT preferences_json FROM user_ui_preferences WHERE user_id = ?')
      .get(userId) as { preferences_json: string } | undefined;

    return row ? parseJson(row.preferences_json) : {};
  },

  /** Merges the given partial preferences into the stored set and returns the full result. */
  updateUiPreferences(userId: number, partial: unknown): UiPreferences {
    const current = uiPreferencesDb.getUiPreferences(userId);
    const next: UiPreferences = { ...current, ...normalize(partial) };

    const db = getConnection();
    db.prepare(
      `INSERT INTO user_ui_preferences (user_id, preferences_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         preferences_json = excluded.preferences_json,
         updated_at = CURRENT_TIMESTAMP`
    ).run(userId, JSON.stringify(next));

    return next;
  },
};
