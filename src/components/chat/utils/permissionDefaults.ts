import type { PermissionMode } from '../types/types';
import type { LLMProvider } from '../../../types/app';

/**
 * Where each provider's global "skip permissions" switch is stored
 * (Settings -> Agents -> <provider> -> Permissions). Providers absent from
 * this map have no such switch.
 */
const SKIP_PERMISSIONS_STORAGE_KEY: Partial<Record<LLMProvider, string>> = {
  claude: 'claude-settings',
  cursor: 'cursor-tools-settings',
};

/** Minimal slice of the Storage API, so this stays testable outside a browser. */
type SettingsStorage = Pick<Storage, 'getItem'>;

const readSkipPermissions = (provider: LLMProvider, storage: SettingsStorage): boolean => {
  const storageKey = SKIP_PERMISSIONS_STORAGE_KEY[provider];
  if (!storageKey) {
    return false;
  }
  try {
    const stored = storage.getItem(storageKey);
    return stored ? Boolean((JSON.parse(stored) as { skipPermissions?: boolean }).skipPermissions) : false;
  } catch {
    // Corrupt/unparsable settings must never silently widen permissions.
    return false;
  }
};

/**
 * Which mode a chat should START in, given the provider's global switch.
 *
 * The switch decides the starting mode rather than overriding the mode
 * server-side, so the composer's mode chip is always the truth: flip one chat
 * back to `default` and it really is asked again. Returns null when the switch
 * is off or unavailable, letting the caller fall back to the backend's
 * capability default.
 */
export function skipPermissionsDefaultMode(
  provider: LLMProvider,
  availableModes: PermissionMode[],
  storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): PermissionMode | null {
  if (!storage || !availableModes.includes('bypassPermissions')) {
    return null;
  }
  return readSkipPermissions(provider, storage) ? 'bypassPermissions' : null;
}

/**
 * What a brand-new chat starts in when nothing else decides it.
 *
 * Bypass rather than `default`, because the owner of this instance wants work
 * to run to completion instead of stopping at every tool prompt. Deliberately
 * independent of the Settings switch above: that switch lives in one browser's
 * localStorage, so relying on it meant a phone and a laptop disagreed about
 * the starting mode. A mode picked inside a chat still wins and is remembered
 * per chat, so a single conversation can always be dropped back to `default`.
 */
export function preferredStartingMode(availableModes: PermissionMode[]): PermissionMode | null {
  return availableModes.includes('bypassPermissions') ? 'bypassPermissions' : null;
}
