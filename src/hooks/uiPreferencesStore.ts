/**
 * The browser side of the account UI preferences, without React: the
 * localStorage cache (`uiPreferences`), the in-page change broadcast and the
 * re-read from the server. `useUiPreferences`, `useUiPreferenceValue` and
 * `useModEnabled` are thin hooks over it.
 *
 * localStorage is this browser's instant-paint cache; the server is the
 * cross-device source of truth. `refreshUiPreferences` pulls the account
 * values into the cache and tells every reader in the page to re-read — the
 * client calls it on the `ui_preferences_changed` frame (settings saved on
 * another device) and when the tab becomes visible again.
 */

import { MOD_KEYS, modDefault, type ModKey } from '../../shared/mods';

type BasePreferences = {
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  sendByDoubleEnter: boolean;
  sidebarVisible: boolean;
  voiceEnabled: boolean;
  /** «Авто-перенос» is switched on in every new chat (server reads it on create). */
  autoRelayNewChats: boolean;
};

/** Built-in mod switches (`shared/mods.ts`), incl. `subagentCrabs`. On by default. */
type ModPreferences = Record<ModKey, boolean>;

export type UiPreferences = BasePreferences & ModPreferences;

export type UiPreferenceKey = keyof UiPreferences;

const MOD_DEFAULTS = Object.fromEntries(MOD_KEYS.map((key) => [key, modDefault(key)])) as ModPreferences;

export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = {
  showRawParameters: false,
  showThinking: true,
  sendByCtrlEnter: false,
  sendByDoubleEnter: false,
  sidebarVisible: true,
  // On by default so the mic button appears out of the box wherever a voice
  // backend is configured. useVoiceAvailable still gates it on a healthy
  // backend, so a deployment with no backend simply shows nothing.
  voiceEnabled: true,
  autoRelayNewChats: false,
  ...MOD_DEFAULTS,
};

export const UI_PREFERENCE_KEYS = Object.keys(DEFAULT_UI_PREFERENCES) as UiPreferenceKey[];

export const DEFAULT_STORAGE_KEY = 'uiPreferences';

/** In-page broadcast: `{storageKey, sourceId, value}`. */
export const UI_PREFERENCES_SYNC_EVENT = 'ui-preferences:sync';

export type UiPreferencesSyncDetail = {
  storageKey: string;
  sourceId: string;
  value: Partial<Record<UiPreferenceKey, unknown>>;
};

const SERVER_SOURCE_ID = 'ui-preferences-server';

export const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  return fallback;
};

const readLegacyPreference = (key: UiPreferenceKey, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    // Supports values written by both JSON.stringify and plain strings.
    const parsed = JSON.parse(raw);
    return parseBoolean(parsed, fallback);
  } catch {
    return fallback;
  }
};

export const readStoredPreferences = (storageKey: string = DEFAULT_STORAGE_KEY): UiPreferences => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_UI_PREFERENCES };
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedRecord = parsed as Record<string, unknown>;

        return UI_PREFERENCE_KEYS.reduce((acc, key) => {
          acc[key] = parseBoolean(parsedRecord[key], DEFAULT_UI_PREFERENCES[key]);
          return acc;
        }, { ...DEFAULT_UI_PREFERENCES });
      }
    }
  } catch {
    // Fall back to legacy keys when unified key is missing or invalid.
  }

  return UI_PREFERENCE_KEYS.reduce((acc, key) => {
    acc[key] = readLegacyPreference(key, DEFAULT_UI_PREFERENCES[key]);
    return acc;
  }, { ...DEFAULT_UI_PREFERENCES });
};

/** One preference as this page currently sees it. */
export const readUiPreference = (key: UiPreferenceKey, storageKey: string = DEFAULT_STORAGE_KEY): boolean =>
  readStoredPreferences(storageKey)[key];

/** Fires `onChange` whenever any preference may have changed (this page, another tab, the server). */
export function subscribeUiPreferences(onChange: () => void): () => void {
  window.addEventListener(UI_PREFERENCES_SYNC_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(UI_PREFERENCES_SYNC_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Writes account values into this browser's cache and tells every reader in the page. */
export function applyServerUiPreferences(
  serverPreferences: unknown,
  storageKey: string = DEFAULT_STORAGE_KEY,
): void {
  if (!serverPreferences || typeof serverPreferences !== 'object' || Array.isArray(serverPreferences)) {
    return;
  }
  const incoming = serverPreferences as Record<string, unknown>;
  const current = readStoredPreferences(storageKey);
  const next = UI_PREFERENCE_KEYS.reduce((acc, key) => {
    if (key in incoming) {
      acc[key] = parseBoolean(incoming[key], current[key]);
    }
    return acc;
  }, { ...current });

  localStorage.setItem(storageKey, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent<UiPreferencesSyncDetail>(UI_PREFERENCES_SYNC_EVENT, {
      detail: { storageKey, sourceId: SERVER_SOURCE_ID, value: next },
    }),
  );
}

type FetchLike = (url: string) => Promise<Pick<Response, 'ok' | 'json'>>;

/**
 * Re-reads the account settings (`GET /api/settings/ui-preferences`) and
 * applies them. Best effort: a failed read keeps what the screen shows.
 */
export async function refreshUiPreferences(
  fetchImpl: FetchLike,
  storageKey: string = DEFAULT_STORAGE_KEY,
): Promise<void> {
  try {
    const response = await fetchImpl('/api/settings/ui-preferences');
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { preferences?: unknown } | null;
    applyServerUiPreferences(data?.preferences, storageKey);
  } catch (error) {
    console.warn('Failed to re-read account UI preferences:', error);
  }
}
