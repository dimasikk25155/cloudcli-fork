/**
 * The neo3-guards rule: an agent must not sit in a foreground wait loop
 * (`until … sleep`, `while … sleep`, `for … sleep`) for longer than the
 * limit. Such a call blocks the whole turn, the chat looks hung, and the
 * person cannot stop the wait without stopping the agent. The model is told
 * to move the wait to the background and watch it with Monitor instead.
 *
 * Pure and dependency-free: the Claude Code mod (`register.ts`) runs it in the
 * plugin sandbox (no Node), and the server can run the same rule as a
 * `PreToolUse` hook.
 */
/** Env var with the limit in seconds; default 120. */
export const FOREGROUND_LOOP_MAX_SEC_ENV = 'NEO3_FOREGROUND_LOOP_MAX_SEC';
export const DEFAULT_FOREGROUND_LOOP_MAX_SEC = 120;
/** What the Bash tool waits when the call names no `timeout`. */
export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
/** Limit in seconds from the env value; anything not a positive number means the default. */
export function readForegroundLoopMaxSec(raw) {
    const parsed = Number(typeof raw === 'string' ? raw.trim() : NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FOREGROUND_LOOP_MAX_SEC;
}
// Quoted text is data, not shell syntax: `grep "until"` is no loop — unless
// it is the script handed to another shell (`ssh host '…'`, `bash -c "…"`).
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
// A loop keyword where a command starts: line start, after ; & | ( { or a
// shell keyword that opens a command list.
const LOOP_KEYWORD = /(?:^|[;&|({]|\b(?:then|do|else)\b)\s*(?:until|while|for)\s/m;
// `do` / `done` as words (not inside other words such as `done.txt`).
const DO_DONE = /(?:^|[;&|({\s])(do|done)(?=[\s;&|)}]|$)/g;
const SLEEP_COMMAND = /(?:^|[;&|({\s])sleep(?:\s|;|$)/m;
// What precedes a quoted argument that is itself a shell script.
const SCRIPT_RUNNER = /(?:^|\s)(?:ssh\s.*|(?:bash|sh|zsh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c[a-zA-Z]*\s+)$/;
const MAX_NESTING = 3;
/** Whether some `do … done` body in the (quote-free) code runs `sleep`. */
function sleepsInLoopBody(code) {
    const opened = [];
    for (const match of code.matchAll(DO_DONE)) {
        const end = (match.index ?? 0) + match[0].length;
        if (match[1] === 'do') {
            opened.push(end);
        }
        else if (opened.length > 0) {
            const bodyStart = opened.pop();
            if (SLEEP_COMMAND.test(code.slice(bodyStart, end - 'done'.length)))
                return true;
        }
    }
    return false;
}
/** Scripts passed as a quoted argument to ssh or `bash|sh|zsh -c`. */
function nestedScripts(command) {
    const scripts = [];
    for (const match of command.matchAll(QUOTED)) {
        const before = command.slice(0, match.index).replace(QUOTED, '""');
        const simpleCommand = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('&'), before.lastIndexOf('|'), before.lastIndexOf('\n')) + 1);
        if (!SCRIPT_RUNNER.test(simpleCommand))
            continue;
        const quoted = match[0];
        const body = quoted.slice(1, -1);
        scripts.push(quoted.startsWith('"') ? body.replace(/\\(["\\$`])/g, '$1') : body);
    }
    return scripts;
}
/** Whether the shell text holds a wait loop: a loop whose body sleeps. */
function hasWaitLoop(command, depth = 0) {
    const code = command.replace(QUOTED, '""');
    if (LOOP_KEYWORD.test(code) && sleepsInLoopBody(code))
        return true;
    return depth < MAX_NESTING && nestedScripts(command).some((script) => hasWaitLoop(script, depth + 1));
}
/**
 * Judges one Bash call. Refused when it runs in the foreground, holds a wait
 * loop, and its timeout (the Bash default when unset) exceeds the limit.
 */
export function judgeForegroundLoop(input, maxSec = DEFAULT_FOREGROUND_LOOP_MAX_SEC) {
    if (input.run_in_background === true)
        return { deny: false };
    if (typeof input.command !== 'string' || !hasWaitLoop(input.command))
        return { deny: false };
    const timeoutMs = typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0
        ? input.timeout
        : BASH_DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= maxSec * 1000)
        return { deny: false };
    return {
        deny: true,
        reason: `Neo3: ожидание-цикл с sleep в основном потоке дольше ${maxSec} с запрещено — чат выглядит зависшим. ` +
            'Уведи в фон (run_in_background: true) и следи через Monitor; ' +
            `либо задай timeout не больше ${maxSec * 1000} мс.`,
    };
}
//# sourceMappingURL=loop-rule.js.map