/**
 * «Фон доживает до конца»: the phase of a live Claude run that is kept alive
 * for its background work.
 *
 * The one rule (it does not depend on whether the CLI reports `idle` while a
 * helper works): the main agent is **between turns** after its `result` and
 * until the next `session_state_changed: running` / `system/init`. Between
 * turns with background work alive the run is held:
 *
 *   helpers (subagents, workflows) alive → `waiting_helpers`
 *   only commands (bash, monitors) alive → `parked`
 *
 * Pure: no timers and no I/O — the Claude runtime (server/claude-sdk.js) owns
 * those and asks this tracker what the stream means.
 */

import type { RunPhase } from '../../../shared/run-phase.js';

import type { BackgroundTask } from './background-tasks.service.js';

export type BackgroundCounts = { agents: number; shells: number };

/** Default ceiling of a hold: long renders and deploys fit, an endless `tail -f` does not keep a chat for a day. */
export const BACKGROUND_HOLD_DEFAULT_MS = 2 * 60 * 60 * 1000;

/**
 * Ceiling of a hold from `NEO3_CLAUDE_BACKGROUND_HOLD_MS`; `0` switches the
 * hold off. Missing or unreadable → the default.
 */
export function backgroundHoldMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.NEO3_CLAUDE_BACKGROUND_HOLD_MS;
  if (raw === undefined || raw.trim() === '') return BACKGROUND_HOLD_DEFAULT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : BACKGROUND_HOLD_DEFAULT_MS;
}

/** Helpers (subagents, workflows — they come back with a reply) against plain commands. */
export function countBackgroundTasks(tasks: ReadonlyArray<Pick<BackgroundTask, 'kind'>> | null | undefined): BackgroundCounts {
  const counts: BackgroundCounts = { agents: 0, shells: 0 };
  for (const task of tasks ?? []) {
    if (task?.kind === 'agent' || task?.kind === 'workflow') counts.agents += 1;
    else counts.shells += 1;
  }
  return counts;
}

/** Body of a `run_phase` frame (the runtime adds kind, session and provider). */
export type RunPhaseChange = {
  phase: RunPhase;
  /** ISO time the phase began. */
  since: string;
  background: BackgroundCounts;
  /** ISO ceiling of the hold; absent while the agent is in a turn. */
  holdUntil?: string;
};

export type RunPhaseTracker = {
  /** Folds one SDK message in, with the tasks alive after it. A change of phase (or of its counts) is returned. */
  apply(message: unknown, tasks: ReadonlyArray<Pick<BackgroundTask, 'kind'>>): RunPhaseChange | null;
  /** A user message went into the live process between turns: the agent is in a turn again. */
  acceptInput(tasks: ReadonlyArray<Pick<BackgroundTask, 'kind'>>): RunPhaseChange | null;
  /** The ceiling passed: nothing is held any more until the next turn ends. */
  expire(): void;
  phase(): RunPhase;
  /** After the main agent's `result`, before its next turn. */
  betweenTurns(): boolean;
  /** The CLI's last word on its state was `idle`. */
  idle(): boolean;
  /** The run is kept alive by these tasks: between turns, some alive, ceiling not passed. */
  holding(tasks: ReadonlyArray<unknown>): boolean;
  /** Epoch ms of the ceiling of the current hold; null in a turn. */
  holdUntilMs(): number | null;
};

export function createRunPhaseTracker(options: { holdMs: number; now?: () => number }): RunPhaseTracker {
  const now = options.now ?? Date.now;
  const holdMs = Math.max(0, options.holdMs);

  let between = false;
  let idle = false;
  let expired = false;
  let resultAt = 0;
  let phase: RunPhase = 'running';
  let since = now();
  let counts: BackgroundCounts = { agents: 0, shells: 0 };

  const holding = (tasks: ReadonlyArray<unknown>): boolean => between && !expired && holdMs > 0 && tasks.length > 0;

  const change = (): RunPhaseChange => ({
    phase,
    since: new Date(since).toISOString(),
    background: { ...counts },
    ...(phase === 'running' ? {} : { holdUntil: new Date(resultAt + holdMs).toISOString() }),
  });

  /** Moves to the phase the current state means; a frame body when something visible changed. */
  const settle = (tasks: ReadonlyArray<Pick<BackgroundTask, 'kind'>>, at: number): RunPhaseChange | null => {
    const nextCounts = countBackgroundTasks(tasks);
    let next: RunPhase;
    if (!between) {
      next = 'running';
    } else if (!holding(tasks)) {
      // Nothing holds the run: it ends (or a turn starts) in a moment. The
      // phase shown stays as it was — the terminal `complete` says the rest.
      return null;
    } else {
      next = nextCounts.agents > 0 ? 'waiting_helpers' : 'parked';
    }

    if (next === phase) {
      if (next === 'running' || (nextCounts.agents === counts.agents && nextCounts.shells === counts.shells)) {
        counts = nextCounts;
        return null;
      }
      counts = nextCounts;
      return change();
    }
    phase = next;
    since = at;
    counts = nextCounts;
    return change();
  };

  const startTurn = (): void => {
    between = false;
    idle = false;
    expired = false;
  };

  return {
    apply(message, tasks) {
      // One reading of the clock per message: a phase that begins with the
      // turn's `result` has `since` = that moment and `holdUntil` = it + the ceiling.
      const at = now();
      if (message && typeof message === 'object') {
        const m = message as Record<string, unknown>;
        if (m.type === 'result') {
          between = true;
          idle = false;
          expired = false;
          resultAt = at;
        } else if (m.type === 'system' && m.subtype === 'session_state_changed') {
          if (m.state === 'running') startTurn();
          else if (m.state === 'idle') idle = true;
        } else if (m.type === 'system' && m.subtype === 'init' && !m.parent_tool_use_id) {
          startTurn();
        }
      }
      return settle(tasks, at);
    },
    acceptInput(tasks) {
      startTurn();
      return settle(tasks, now());
    },
    expire() {
      expired = true;
    },
    phase: () => phase,
    betweenTurns: () => between,
    idle: () => idle,
    holding,
    holdUntilMs: () => (between && !expired && holdMs > 0 ? resultAt + holdMs : null),
  };
}
