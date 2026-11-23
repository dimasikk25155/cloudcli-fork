/**
 * Phases of a live Claude run that is kept alive for its background work.
 * Types only — no logic, no database: shared by the server and the client.
 *
 * - `running`         — the main agent is in a turn.
 * - `waiting_helpers` — between turns, background helpers (subagents) are
 *   alive. The chat status stays `working`.
 * - `parked`          — between turns, only background commands are alive.
 *   The chat status is the one of an ordinary turn end (`done` / `waiting`),
 *   but the run is still alive and will wake up by itself.
 */
export type RunPhase = 'running' | 'waiting_helpers' | 'parked';

/** Status frame of a live run. Not a chat row (never goes into CHAT_ROW_KINDS). */
export type RunPhaseFrame = {
  kind: 'run_phase';
  sessionId: string;
  provider: 'claude';
  phase: RunPhase;
  /** ISO time the phase began. */
  since: string;
  background: { agents: number; shells: number };
  /** ISO ceiling of the hold (for `parked` / `waiting_helpers`). */
  holdUntil?: string;
};
