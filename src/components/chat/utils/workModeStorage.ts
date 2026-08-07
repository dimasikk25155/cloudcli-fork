import { WORK_MODES } from '../types/types';
import type { WorkMode } from '../types/types';

/**
 * Where a chat's work mode comes from.
 *
 * Two layers, deliberately in this order:
 * 1. the chat's own record (`workMode-<sessionId>`), written when the user
 *    picks a mode in that conversation;
 * 2. the account default (`work-mode-default`, mirrored from the server and
 *    changed only in Settings -> Agents -> New chats).
 *
 * There is no third layer: a chat that never picked a mode must never inherit
 * one from whatever conversation happened to be open before it.
 */

export const WORK_MODE_DEFAULT_KEY = 'work-mode-default';

export const workModeStorageKey = (sessionId: string): string => `workMode-${sessionId}`;

/** The mode used when nothing has ever been chosen (unchanged legacy behaviour). */
export const FALLBACK_WORK_MODE: WorkMode = 'autopilot';

/** Minimal slice of the Storage API, so this stays testable outside a browser. */
type ModeStorage = Pick<Storage, 'getItem'>;

const asWorkMode = (value: string | null): WorkMode | null => (
  value && (WORK_MODES as string[]).includes(value) ? (value as WorkMode) : null
);

export function readDefaultWorkMode(
  storage: ModeStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): WorkMode {
  if (!storage) {
    return FALLBACK_WORK_MODE;
  }
  return asWorkMode(storage.getItem(WORK_MODE_DEFAULT_KEY)) ?? FALLBACK_WORK_MODE;
}

export function readSessionWorkMode(
  sessionId: string | null | undefined,
  storage: ModeStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): WorkMode {
  if (storage && sessionId) {
    const saved = asWorkMode(storage.getItem(workModeStorageKey(sessionId)));
    if (saved) {
      return saved;
    }
  }
  return readDefaultWorkMode(storage);
}
