import { useSyncExternalStore } from 'react';

import { modDefault, type ModKey } from '../../shared/mods';

import { readUiPreference, subscribeUiPreferences } from './uiPreferencesStore';

/**
 * Where a mod switch is read from: this browser's copy of the account
 * settings, refreshed by another tab (`storage`), by this page's settings
 * screen and by the server on `ui_preferences_changed`.
 */
export const modEnabledSource = {
  subscribe: subscribeUiPreferences,
  read: (key: ModKey): boolean => readUiPreference(key),
};

/**
 * Is the built-in mod on for this user? On until switched off in
 * «Настройки → Плагины → Встроенные моды». Read-only and fetch-free, so it is
 * cheap in components rendered many times.
 */
export function useModEnabled(key: ModKey): boolean {
  return useSyncExternalStore(
    modEnabledSource.subscribe,
    () => modEnabledSource.read(key),
    () => modDefault(key),
  );
}
