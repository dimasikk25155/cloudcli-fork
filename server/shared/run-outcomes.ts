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
export function buildRunInterruptedNotice(reason: string | null): string {
  const r = (reason || '').toLowerCase();
  let cause: string;
  if (r.includes('session limit')) {
    // Keep the reset time from the original message if present.
    const resetMatch = (reason || '').match(/resets?\s+([^.\n]+)/i);
    cause = resetMatch
      ? `достигнут лимит подписки Claude — сброс в ${resetMatch[1].trim()}.`
      : 'достигнут лимит подписки Claude — дождись сброса лимита.';
  } else if (r.includes('overloaded') || r.includes('529')) {
    // Only reachable after the automatic retries in claude-sdk.js gave up.
    cause = 'серверы Anthropic перегружены (529) — автоповторы не помогли, обычно отпускает за несколько минут.';
  } else if (r.includes('connection closed') || r.includes('closed mid-response') || r.includes('connection error')) {
    cause = 'оборвалась связь с API Anthropic посреди ответа — ответ неполный.';
  } else if (r.includes('ede_diagnostic') || r.includes('stop_reason=tool_use')) {
    cause = 'Claude Code оборвал ход на выполнении инструмента (внутренняя ошибка CLI).';
  } else if (r.includes('not installed')) {
    cause = reason || 'Claude Code не установлен.';
  } else if (reason) {
    cause = reason;
  } else {
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
const RETRYABLE_FAILURE_RE =
  /\b529\b|overloaded|\b50[234]\b|bad gateway|service unavailable|gateway timeout|internal server error|connection closed|closed mid-response|connection error|fetch failed|socket hang up|econnreset|etimedout|enotfound/i;

const PERMANENT_FAILURE_RE =
  /session limit|usage limit|not installed|credit balance|invalid api key|authentication_error|permission_denied/i;

export function isTransientRunFailure(reason: string | null | undefined): boolean {
  const r = String(reason || '');
  if (!r || PERMANENT_FAILURE_RE.test(r)) {
    return false;
  }
  return RETRYABLE_FAILURE_RE.test(r);
}

export type RunOutcomeStatus = 'completed' | 'failed' | 'aborted';

export interface RunOutcome {
  status: RunOutcomeStatus;
  reason: string | null;
  at: string;
}

const OUTCOMES_PATH = path.join(os.homedir(), '.cloudcli', 'run-outcomes.json');
const MAX_ENTRIES = 300;

// Serialize writes so concurrent run endings don't clobber each other.
let writeChain: Promise<void> = Promise.resolve();

async function readAll(): Promise<Record<string, RunOutcome>> {
  try {
    const raw = await fs.readFile(OUTCOMES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RunOutcome>) : {};
  } catch {
    return {};
  }
}

/** Record how a run ended. Best-effort: never throws into the run loop. */
export function recordRunOutcome(
  sessionId: string | null | undefined,
  outcome: { status: RunOutcomeStatus; reason?: string | null },
): Promise<void> {
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
      } catch {
        // best-effort persistence; a failed write must not break the run
      }
    })
    .catch(() => {});
  return writeChain;
}

/** Read the last recorded outcome for a session, or null if none. */
export async function readRunOutcome(
  sessionId: string | null | undefined,
): Promise<RunOutcome | null> {
  if (!sessionId) {
    return null;
  }
  const all = await readAll();
  return all[sessionId] || null;
}
