/**
 * Server-side read of the built-in mod switches (registry: `shared/mods.ts`).
 *
 * A mod is on unless the user's account preferences say `false`: no user
 * (a system run), no stored key, or a failed read all leave it on — a broken
 * settings read must not silently strip features. Synchronous, so services
 * can check it right where work "for the human" starts. Service factories
 * take it as a dependency (`isModOn`) the same way auto-relay takes
 * `newChatsDefault`.
 */

import { uiPreferencesDb } from '@/modules/database/index.js';

import { modDefault, type ModKey } from '../../shared/mods.js';

export type { ModKey } from '../../shared/mods.js';

export type IsModOn = (userId: number | null | undefined, key: ModKey) => boolean;

type ReadPreferences = (userId: number) => Record<string, unknown>;

export function createIsModOn(readPreferences: ReadPreferences): IsModOn {
  return (userId, key) => {
    if (userId === null || userId === undefined || !Number.isFinite(Number(userId))) {
      return modDefault(key);
    }
    try {
      const value = readPreferences(Number(userId))[key];
      return typeof value === 'boolean' ? value : modDefault(key);
    } catch {
      // Settings unreadable → keep the mod on (never strip a feature by accident).
      return modDefault(key);
    }
  };
}

export const isModOn: IsModOn = createIsModOn((userId) => uiPreferencesDb.getUiPreferences(userId));
