/**
 * "The session went quiet" (spec story 44, R38i, decision 20).
 *
 * Sessions in Neo3 are never closed explicitly, so "finished" is inferred:
 *   - the status row says `done` for at least 30 minutes (no new run since);
 *   - the transcript holds at least two messages Dima actually typed;
 *   - the agent edited a file or ran a command at least once.
 * A conversation without edits or commands rarely carries a fact worth a
 * vault note, and a single-prompt session is usually a quick lookup.
 */
import { isInjectedUserText } from '../../../shared/reply-turn.js';
export const QUIET_AFTER_MS = 30 * 60_000;
/**
 * Older quiet sessions are not reviewed: the first start after deploy must not
 * sweep the whole history into the model, and a day-old session is cold anyway.
 */
export const QUIET_MAX_AGE_MS = 24 * 60 * 60_000;
export const MIN_USER_MESSAGES = 2;
/**
 * Tools that change the tree or run something, for every engine:
 * Claude (Write/Edit/MultiEdit/NotebookEdit/Bash), Codex (Bash, FileChanges,
 * apply_patch/shell in raw logs), Grok (run_terminal_command, search_replace,
 * write, edit_file, create_file). Compared case-insensitively.
 */
const WORK_TOOLS = new Set([
    'Write',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'Bash',
    'ApplyPatch',
    'apply_patch',
    'FileChanges',
    'shell',
    'exec_command',
    'run_terminal_command',
    'search_replace',
    'edit_file',
    'create_file',
    'str_replace',
].map((name) => name.toLowerCase()));
/** Status-only half of the test: cheap, decides whether the transcript is read at all. */
export function isQuietStatus(status, now) {
    if (status.state !== 'done') {
        return false;
    }
    const updatedMs = Date.parse(status.updatedAt);
    if (!Number.isFinite(updatedMs)) {
        return false;
    }
    const idleMs = now.getTime() - updatedMs;
    return idleMs >= QUIET_AFTER_MS && idleMs <= QUIET_MAX_AGE_MS;
}
/** Transcript half: ≥2 typed user messages and at least one edit/command tool call. */
export function hasWorkWorthNoting(messages) {
    let userMessages = 0;
    let didWork = false;
    for (const message of messages) {
        if (message.kind === 'text'
            && message.role === 'user'
            && typeof message.content === 'string'
            && message.content.trim()
            && !isInjectedUserText(message.content)) {
            userMessages += 1;
        }
        else if (message.kind === 'tool_use'
            && typeof message.toolName === 'string'
            && WORK_TOOLS.has(message.toolName.toLowerCase())) {
            didWork = true;
        }
    }
    return didWork && userMessages >= MIN_USER_MESSAGES;
}
//# sourceMappingURL=quiet-session.js.map