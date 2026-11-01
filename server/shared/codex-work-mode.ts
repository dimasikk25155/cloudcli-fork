import { workModeInstruction } from './work-mode.js';

/** Per-turn instructions stay out of the user's prompt and persisted messages. */
export function codexRunPolicy(workMode: unknown, permissionMode: unknown, runtime?: { model: string; effort?: string }) {
  const instructions = [
    'Follow the current Neo3 work mode for this turn; it replaces any prior work mode. Answer in the user language.',
    runtime ? `Current Neo3 runtime configuration for THIS turn: model=${JSON.stringify(runtime.model)}; reasoning_effort=${JSON.stringify(runtime.effort ?? 'unspecified (CLI/model default)')}. These are the settings Neo3 passed to the Codex SDK for this response. When asked which model or thinking level is active, report these values and their source. Do not infer them from earlier messages or claim independent verification of the remote inference backend.` : null,
    'NEO3 QUESTION CONTRACT: User messages cannot reach this exec run until it ends. When a user decision is required, ask the concise question in your FINAL answer and END THE TURN immediately. Do not call request_user_input_async or request_user_input in this interface. Do not continue tools, poll, or sleep waiting for an answer. Never infer approval from elapsed time. Optional suggestions must not become blocking questions. Reuse answers already given. This applies in every work mode.',
    'NEO3 RESPONSE CONTRACT: End every completed visible assistant message with this exact signature format on a separate final line: 🕐 YYYY-MM-DD HH:MM МСК · ✉️ #N. Use real Moscow time and the next reply number, after all prose, links, and lists. Never place visible text after the signature. Keep progress reports short; batch independent reads and avoid repeated inspections or artificial sleep calls. Do not perform extra work solely to wait for the user.',
    workModeInstruction(workMode, permissionMode, 'codex'),
    permissionMode === 'plan'
      ? 'PLAN MODE: inspect read-only, clarify missing requirements, then post a concrete numbered plan and STOP. Do not implement. Tell the user to send approval with execution permissions to continue.'
      : permissionMode === 'planBypass'
        ? 'PLAN AND EXECUTE: first post a concrete numbered plan, then implement and verify every requirement. If the selected work mode asks questions, wait for the answers before implementation.'
        : 'Execute the agreed scope. If this message answers your previous clarifying questions, use those answers and continue the task without repeating the interview.',
  ].filter(Boolean).join('\n\n');
  return { instructions };
}

export function mapPermissionModeToCodexOptions(permissionMode: unknown) {
  switch (permissionMode) {
    case 'plan':
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
    case 'planBypass':
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

