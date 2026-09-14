import type { PermissionMode, WorkMode } from '../types/types';

/**
 * Where the composer lands after a one-shot mode has been sent.
 *
 * Work modes (briefs / interrogate / autopilot-build) and permission modes
 * (plan / plan+bypass / ask-always) are one use: the message that is in
 * flight keeps the mode that was on the chip, and the NEXT message is
 * ordinary work with permissions already granted. Re-picking a mode is
 * how the user asks for another one-shot.
 */
export const IDLE_WORK_MODE: WorkMode = 'autopilot';

export function idlePermissionMode(
  availableModes: readonly (PermissionMode | string)[],
): PermissionMode {
  return availableModes.includes('bypassPermissions') ? 'bypassPermissions' : 'default';
}

export function isIdleComposerModes(
  workMode: WorkMode | string,
  permissionMode: PermissionMode | string,
  availableModes: readonly (PermissionMode | string)[],
): boolean {
  return workMode === IDLE_WORK_MODE && permissionMode === idlePermissionMode(availableModes);
}
