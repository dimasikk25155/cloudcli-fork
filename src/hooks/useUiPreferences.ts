import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';

import { authenticatedFetch } from '../utils/api';

import {
  DEFAULT_STORAGE_KEY,
  DEFAULT_UI_PREFERENCES,
  UI_PREFERENCE_KEYS,
  UI_PREFERENCES_SYNC_EVENT,
  parseBoolean,
  readStoredPreferences,
  readUiPreference,
  refreshUiPreferences,
  subscribeUiPreferences,
  type UiPreferenceKey,
  type UiPreferences,
  type UiPreferencesSyncDetail,
} from './uiPreferencesStore';

type SetPreferenceAction = {
  type: 'set';
  key: UiPreferenceKey;
  value: unknown;
};

type SetManyPreferencesAction = {
  type: 'set_many';
  value?: Partial<Record<UiPreferenceKey, unknown>>;
};

type ResetPreferencesAction = {
  type: 'reset';
  value?: Partial<UiPreferences>;
};

type UiPreferencesAction =
  | SetPreferenceAction
  | SetManyPreferencesAction
  | ResetPreferencesAction;

// Exported so other readers of the stored preferences blob (e.g. useVoiceAvailable)
// fall back to the same defaults instead of hard-coding their own.
export const UI_PREFERENCE_DEFAULTS: Readonly<UiPreferences> = DEFAULT_UI_PREFERENCES;

const VALID_KEYS = new Set<UiPreferenceKey>(UI_PREFERENCE_KEYS); // prevents unknown keys from being written

function reducer(state: UiPreferences, action: UiPreferencesAction): UiPreferences {
  switch (action.type) {
    case 'set': {
      const { key, value } = action;
      if (!VALID_KEYS.has(key)) {
        return state;
      }

      const nextValue = parseBoolean(value, state[key]);
      if (state[key] === nextValue) {
        return state;
      }

      return { ...state, [key]: nextValue };
    }
    case 'set_many': {
      const updates = action.value || {};
      let changed = false;
      const nextState = { ...state };

      for (const key of UI_PREFERENCE_KEYS) {
        if (!(key in updates)) continue;

        const value = updates[key];
        const nextValue = parseBoolean(value, state[key]);
        if (nextState[key] !== nextValue) {
          nextState[key] = nextValue;
          changed = true;
        }
      }

      return changed ? nextState : state;
    }
    case 'reset':
      return { ...DEFAULT_UI_PREFERENCES, ...(action.value || {}) };
    default:
      return state;
  }
}

export function useUiPreferences(storageKey = DEFAULT_STORAGE_KEY) {
  const instanceIdRef = useRef(`ui-preferences-${Math.random().toString(36).slice(2)}`);
  const [state, dispatch] = useReducer(
    reducer,
    storageKey,
    readStoredPreferences
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(state));

    window.dispatchEvent(
      new CustomEvent<UiPreferencesSyncDetail>(UI_PREFERENCES_SYNC_EVENT, {
        detail: {
          storageKey,
          sourceId: instanceIdRef.current,
          value: state,
        },
      })
    );
  }, [state, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyExternalUpdate = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      dispatch({ type: 'set_many', value: value as Partial<Record<UiPreferenceKey, unknown>> });
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue === null) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue);
        applyExternalUpdate(parsed);
      } catch {
        // Ignore malformed storage updates.
      }
    };

    const handleSyncEvent = (event: Event) => {
      const syncEvent = event as CustomEvent<UiPreferencesSyncDetail>;
      const detail = syncEvent.detail;
      if (!detail || detail.storageKey !== storageKey || detail.sourceId === instanceIdRef.current) {
        return;
      }

      applyExternalUpdate(detail.value);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(UI_PREFERENCES_SYNC_EVENT, handleSyncEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(UI_PREFERENCES_SYNC_EVENT, handleSyncEvent as EventListener);
    };
  }, [storageKey]);

  // Account-wide values, loaded once on mount and applied on top of whatever
  // localStorage had (server is the cross-device source of truth; localStorage
  // is just this browser's instant-paint cache). The one shared re-read writes
  // the cache and broadcasts it; this instance takes it through the sync
  // listener above, so hydration doesn't itself trigger a sync-back PUT.
  useEffect(() => {
    void refreshUiPreferences(authenticatedFetch, storageKey);
  }, [storageKey]);

  // Fire-and-forget: push the change to the account so every other device
  // picks it up on its next load. Local state/localStorage already made the
  // change feel instant on this device; a failed sync just means other
  // devices stay on the old value until it succeeds again.
  const syncToServer = (value: Partial<Record<UiPreferenceKey, unknown>>) => {
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify(value),
    }).catch((error) => {
      console.warn('Failed to sync UI preference to account:', error);
    });
  };

  const setPreference = (key: UiPreferenceKey, value: unknown) => {
    dispatch({ type: 'set', key, value });
    syncToServer({ [key]: value });
  };

  const setPreferences = (value: Partial<Record<UiPreferenceKey, unknown>>) => {
    dispatch({ type: 'set_many', value });
    syncToServer(value);
  };

  const resetPreferences = (value?: Partial<UiPreferences>) => {
    dispatch({ type: 'reset', value });
  };

  return {
    preferences: state,
    setPreference,
    setPreferences,
    resetPreferences,
    dispatch,
  };
}

/**
 * One preference, read-only, for components rendered many times (a row per
 * subagent): no server fetch of its own — it follows the value the app-level
 * `useUiPreferences` hydrates into localStorage and broadcasts on change.
 */
export function useUiPreferenceValue(key: UiPreferenceKey, storageKey = DEFAULT_STORAGE_KEY): boolean {
  return useSyncExternalStore(
    subscribeUiPreferences,
    () => readUiPreference(key, storageKey),
    () => DEFAULT_UI_PREFERENCES[key],
  );
}
