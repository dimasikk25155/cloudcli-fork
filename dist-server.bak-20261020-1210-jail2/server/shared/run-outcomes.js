import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/**
 * Persistent per-session record of how the last run ended.
 *
 * A run can die mid-turn (subscription session limit, API connection dropped,
 * stream aborted on a tool call). The failure is delivered to the client only
 * as an ephemeral websocket `error` frame — if the user is not looking at that
 * session when it fires, the signal is lost, and on reload the transcript just
 * ends on the last tool result with no indication that anything went wrong.
 *
 * This store lets the history reader surface a durable "run interrupted" marker
 * with the actual reason, so the chat always shows whether a turn finished,
 * failed, or was cancelled — even after switching sessions or restarting the
 * server.
 */
/**
 * Turns a raw SDK failure string into a short, human-readable notice shown in
 * the chat when a run died mid-turn. Single source of truth for BOTH the live
 * error frame (claude-sdk.js) and the durable history marker
 * (claude-sessions.provider.ts), so the user sees the same clear reason live
 * and on reload — never a raw `[ede_diagnostic] ...` dump.
 */
/**
 * Claude Code 2.1.29x reports a stream that died after partial output as
 * "<kind> mid-response. The response above may be incomplete." (server error,
 * connection lost, stalled, never arrived, malformed). Older CLIs said
 * "Connection closed mid-response"; both are a one-off Anthropic hiccup.
 */
const MID_RESPONSE_DROP_RE = /mid-response|response stopped arriving|never arrived|stream was malformed|response stalled|stream idle timeout/i;
export function buildRunInterruptedNotice(reason) {
    const r = (reason || '').toLowerCase();
    let cause;
    if (r.includes('session limit')) {
        // Keep the reset time from the original message if present.
        const resetMatch = (reason || '').match(/resets?\s+([^.\n]+)/i);
        cause = resetMatch
            ? `достигнут лимит подписки Claude — сброс в ${resetMatch[1].trim()}.`
            : 'достигнут лимит подписки Claude — дождись сброса лимита.';
    }
    else if (r.includes('overloaded') || r.includes('529')) {
        // Only reachable after the automatic retries in claude-sdk.js gave up.
        cause = 'серверы Anthropic перегружены (529) — автоповторы не помогли, обычно отпускает за несколько минут.';
    }
    else if (r.includes('server error mid-response')) {
        cause = 'сервер Anthropic выдал ошибку посреди ответа — автоповторы не помогли, ответ неполный.';
    }
    else if (r.includes('connection closed') || MID_RESPONSE_DROP_RE.test(r) || r.includes('connection error')) {
        cause = 'оборвалась связь с API Anthropic посреди ответа — ответ неполный.';
    }
    else if (r.includes('ede_diagnostic') || r.includes('stop_reason=tool_use')) {
        cause = 'Claude Code оборвал ход на выполнении инструмента (внутренняя ошибка CLI).';
    }
    else if (r.includes('not installed')) {
        cause = reason || 'Claude Code не установлен.';
    }
    else if (reason) {
        cause = reason;
    }
    else {
        cause = 'прогон завершился без финального ответа.';
    }
    return `⏹ Прогон прерван — финального ответа нет.\nПричина: ${cause}\nОтправь сообщение заново, чтобы продолжить.`;
}
/**
 * Failures that a plain retry fixes: Anthropic's servers being overloaded or
 * unreachable for a moment. Re-sending the same turn is exactly what the user
 * used to do by hand, so the run loop does it for them (see
 * TRANSIENT_RETRY_DELAYS_MS in claude-sdk.js).
 *
 * Deliberately excluded: subscription limits, missing CLI, auth/billing
 * problems. Those repeat forever no matter how many times we retry, so they
 * must reach the user as a notice instead of a silent retry loop.
 */
const RETRYABLE_FAILURE_RE = /\b529\b|overloaded|\b50[234]\b|bad gateway|service unavailable|gateway timeout|internal server error|connection closed|mid-response|response stopped arriving|never arrived|stream was malformed|response stalled|stream idle timeout|connection error|fetch failed|socket hang up|econnreset|etimedout|enotfound/i;
const PERMANENT_FAILURE_RE = /session limit|usage limit|not installed|credit balance|invalid api key|authentication_error|permission_denied/i;
/**
 * Claude Code rewords its stream errors between releases (2.1.29x replaced
 * "Connection closed mid-response" with "Server error mid-response" etc.), and
 * engines auto-update nightly, so an exact phrase list silently goes stale.
 * Fallback: any "API Error" from the CLI is treated as a server wobble unless
 * it is clearly a request the API rejected (4xx other than 408/409/429,
 * invalid request, oversized prompt) — those would fail the same way again.
 */
const API_ERROR_RE = /\bapi error\b|may be incomplete/i;
const REJECTED_REQUEST_RE = /\b4(?!08|09|29)\d\d\b|invalid_request|invalid request|prompt is too long|too large|not_found_error|model.*not (found|available|supported)/i;
export function isTransientRunFailure(reason) {
    const r = String(reason || '');
    if (!r || PERMANENT_FAILURE_RE.test(r)) {
        return false;
    }
    if (RETRYABLE_FAILURE_RE.test(r)) {
        return true;
    }
    return API_ERROR_RE.test(r) && !REJECTED_REQUEST_RE.test(r);
}
const OUTCOMES_PATH = path.join(os.homedir(), '.cloudcli', 'run-outcomes.json');
const MAX_ENTRIES = 300;
// Serialize writes so concurrent run endings don't clobber each other.
let writeChain = Promise.resolve();
async function readAll() {
    try {
        const raw = await fs.readFile(OUTCOMES_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Record how a run ended. Best-effort: never throws into the run loop. */
export function recordRunOutcome(sessionId, outcome) {
    if (!sessionId) {
        return Promise.resolve();
    }
    writeChain = writeChain
        .then(async () => {
        const all = await readAll();
        all[sessionId] = {
            status: outcome.status,
            reason: outcome.reason ? String(outcome.reason).slice(0, 500) : null,
            at: new Date().toISOString(),
        };
        const keys = Object.keys(all);
        if (keys.length > MAX_ENTRIES) {
            keys.sort((a, b) => (all[a].at || '').localeCompare(all[b].at || ''));
            for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) {
                delete all[stale];
            }
        }
        try {
            await fs.mkdir(path.dirname(OUTCOMES_PATH), { recursive: true });
            await fs.writeFile(OUTCOMES_PATH, JSON.stringify(all), 'utf8');
        }
        catch {
            // best-effort persistence; a failed write must not break the run
        }
    })
        .catch(() => { });
    return writeChain;
}
/** Read the last recorded outcome for a session, or null if none. */
export async function readRunOutcome(sessionId) {
    if (!sessionId) {
        return null;
    }
    const all = await readAll();
    return all[sessionId] || null;
}
//# sourceMappingURL=run-outcomes.js.map