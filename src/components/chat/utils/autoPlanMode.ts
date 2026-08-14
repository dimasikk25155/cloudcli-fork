import type { PendingPermissionRequest, PermissionMode } from '../types/types';

/**
 * "Plan + auto-run": the agent writes a plan, approves it on the user's behalf
 * and then carries it out to the end without a single prompt.
 *
 * The backend knows nothing about it — it is `plan` on the wire (so the run
 * really does start read-only and really does produce a plan), and the client
 * answers the ExitPlanMode prompt itself. Approving ExitPlanMode already flips
 * the run to `bypassPermissions` server-side (see claude-sdk.js), so the rest
 * of the run never asks again.
 */
export const AUTO_PLAN_MODE = 'planBypass' satisfies PermissionMode;

/**
 * Questions are not permissions: AskUserQuestion asks the user to CHOOSE, and
 * there is no sane answer to auto-fill — approving it blind would make the
 * agent act on an empty choice. Everything else gets approved automatically.
 */
const NEVER_AUTO_APPROVED = new Set(['AskUserQuestion']);

/**
 * Adds the auto-plan entry to a provider's mode list, right after `plan`.
 * Providers that can't do both plan and bypass are left untouched — the mode is
 * literally the two of them chained.
 */
export function withAutoPlanMode(modes: readonly PermissionMode[]): PermissionMode[] {
  if (!modes.includes('plan') || !modes.includes('bypassPermissions') || modes.includes(AUTO_PLAN_MODE)) {
    return [...modes];
  }
  return modes.flatMap((mode) => (mode === 'plan' ? [mode, AUTO_PLAN_MODE] : [mode]));
}

/** What the backend is told to run: the auto-plan mode is plain `plan` there. */
export function toWirePermissionMode(mode: PermissionMode | string): PermissionMode | string {
  return mode === AUTO_PLAN_MODE ? 'plan' : mode;
}

export const isAutoPlanMode = (mode: PermissionMode | string): boolean => mode === AUTO_PLAN_MODE;

/**
 * Which pending prompts this mode answers by itself. Returns request ids so the
 * caller can hand them straight to the existing permission-decision path (one
 * "allow" per id), instead of teaching it about a second kind of approval.
 */
export function autoApprovedRequestIds(
  mode: PermissionMode | string,
  pendingRequests: readonly PendingPermissionRequest[],
): string[] {
  if (!isAutoPlanMode(mode)) {
    return [];
  }
  return pendingRequests
    .filter((request) => !NEVER_AUTO_APPROVED.has(request.toolName))
    .map((request) => request.requestId)
    .filter(Boolean);
}
