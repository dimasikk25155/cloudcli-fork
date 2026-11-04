import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { getConnection, isUiPreferenceKey, uiPreferencesDb } from '@/modules/database/index.js';

import { createSettingsProfileService, type SettingsProfileService } from './settings-profile.service.js';

let service: SettingsProfileService | undefined;

/** Production wiring: `workspace_records` of the app database and the account's ui-preferences. */
export function getSettingsProfileService(): SettingsProfileService {
  return service ??= createSettingsProfileService({
    store: createWorkspaceStore(getConnection()),
    prefs: {
      get: (userId) => uiPreferencesDb.getUiPreferences(userId),
      update: (userId, partial) => uiPreferencesDb.updateUiPreferences(userId, partial),
      remove: (userId, keys) => uiPreferencesDb.removeUiPreferenceKeys(userId, keys),
    },
    isAllowedKey: isUiPreferenceKey,
    notify: (userId) => {
      void import('@/modules/websocket/index.js')
        .then((ws) => ws.notifyUiPreferencesChanged(userId))
        .catch(() => undefined);
    },
  });
}
