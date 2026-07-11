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
