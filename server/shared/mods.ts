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
import { AppError } from '@/shared/utils.js';

import { MOD_OFF, MODS, modDefault, modOffMessage, type ModKey } from '../../shared/mods.js';

export type { ModKey, ModOff } from '../../shared/mods.js';
export { MOD_OFF, modOffMessage } from '../../shared/mods.js';

/** Any user id as callers hold it (socket ids may be strings); not a number → default. */
export type ModUserId = string | number | null | undefined;

export type IsModOn = (userId: ModUserId, key: ModKey) => boolean;

type ReadPreferences = (userId: number) => Record<string, unknown>;

function toUserId(userId: ModUserId): number | null {
  if (userId === null || userId === undefined || userId === '') return null;
  const numeric = Number(userId);
  return Number.isFinite(numeric) ? numeric : null;
}

export function createIsModOn(readPreferences: ReadPreferences): IsModOn {
  return (userId, key) => {
    const id = toUserId(userId);
    if (id === null) {
      return modDefault(key);
    }
    try {
      const value = readPreferences(id)[key];
      return typeof value === 'boolean' ? value : modDefault(key);
    } catch {
      // Settings unreadable → keep the mod on (never strip a feature by accident).
      return modDefault(key);
    }
  };
}

export const isModOn: IsModOn = createIsModOn((userId) => uiPreferencesDb.getUiPreferences(userId));

/**
 * Whether a mod actually works for a user: its own switch and, following
 * `requires` of the registry, the switch of every mod it depends on
 * (answer buttons work only together with «Ждут тебя»). The one place the
 * dependency is evaluated; `using` is the switch reader (injected in tests).
 */
export function isModActive(userId: ModUserId, key: ModKey, using: IsModOn = isModOn): boolean {
  const seen = new Set<ModKey>();
  let current: ModKey | undefined = key;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (!using(userId, current)) return false;
    current = MODS.find((mod) => mod.key === current)?.requires;
  }
  return true;
}

/** `409 {code:'MOD_OFF'}` for routes and services that refuse work of a switched-off mod. */
export function modOffError(key: ModKey): AppError {
  return new AppError(modOffMessage(key), { code: MOD_OFF, statusCode: 409, details: { mod: key } });
}
