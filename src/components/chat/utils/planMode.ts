import type { PendingPermissionRequest, PermissionMode } from '../types/types';

/** The CLI emits `ExitPlanMode`; older/other runtimes use the snake_case id. */
export const isExitPlanModeTool = (toolName: string): boolean =>
  toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode';

/**
 * Where the composer lands once the plan is approved.
 *
 * Approving the plan IS the consent: the point of writing a plan first is that
 * the agent then executes it end to end, without a permission prompt on every
 * single step it just got signed off. So we go to `bypassPermissions`, and only
 * fall back to `default` for providers that don't offer it (the mode list comes
 * from the backend capability catalog, so it can shrink per provider).
 */
export function permissionModeAfterPlanApproval(
  availableModes: readonly (PermissionMode | string)[],
): PermissionMode {
  return availableModes.includes('bypassPermissions') ? 'bypassPermissions' : 'default';
}

/**
 * True when this permission decision is "the user accepted the plan", which is
 * the moment plan mode has to end: the agent leaves read-only for the rest of
 * the run (server side, via setMode) and the composer must follow, or the NEXT
 * message would silently be sent read-only again.
 *
 * Rejecting the plan ("revise") deliberately keeps plan mode on.
 */
export function decisionExitsPlanMode(
  currentMode: PermissionMode | string,
  pendingRequests: PendingPermissionRequest[],
  requestIds: string | string[],
  allow: boolean | undefined,
): boolean {
  if (!allow || currentMode !== 'plan') {
    return false;
  }

  const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
  return pendingRequests.some(
    (request) => ids.includes(request.requestId) && isExitPlanModeTool(request.toolName),
  );
}
