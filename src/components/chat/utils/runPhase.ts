import type { RunPhase, RunPhaseFrame } from '../../../../shared/run-phase';

/** i18n-style translate: key, interpolation values, English default. */
export type PhaseTranslate = (key: string, values: Record<string, string | number> | undefined, defaultValue: string) => string;

/** Same clock as the «🕐 дата МСК» signature under an answer. */
const DISPLAY_TIME_ZONE = 'Europe/Moscow';

function clock(iso: string, now: number, timeZone: string): string {
  const parsed = Date.parse(iso);
  const at = new Date(Number.isFinite(parsed) ? parsed : now);
  return new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * What the chat is waiting for, in a line, while the run is alive between turns:
 * `waiting_helpers` → «ждёт помощников: N · с ЧЧ:ММ», `parked` → «ход закончен · фон: N —
 * агент вернётся сам». A running turn, no frame or an unknown phase → `null`: the old
 * «идёт ход» indicator stays as it was.
 */
export function runPhaseLabel(
  frame: RunPhaseFrame | null | undefined,
  now: number,
  t: PhaseTranslate,
  timeZone: string = DISPLAY_TIME_ZONE,
): string | null {
  if (!frame) return null;
  const agents = count(frame.background?.agents);
  const shells = count(frame.background?.shells);
  if (frame.phase === 'waiting_helpers') {
    return t('claudeStatus.phase.waitingHelpers', { count: agents || agents + shells, time: clock(frame.since, now, timeZone) },
      'waiting for helpers: {{count}} · since {{time}}');
  }
  if (frame.phase === 'parked') {
    return t('claudeStatus.phase.parked', { count: agents + shells },
      'turn finished · background: {{count}} — the agent will come back by itself');
  }
  return null;
}

/**
 * The agent is NOT in a turn: the composer is free (a message goes out as an ordinary
 * `chat.send` and wakes the held run) while «Прервать» stays on the activity bar.
 */
export function isBetweenTurns(frame: RunPhaseFrame | null | undefined): boolean {
  return frame?.phase === 'waiting_helpers' || frame?.phase === 'parked';
}

/** «Стоп» killed background work: the line under the stop point. Nothing killed → `null`. */
export function killedBackgroundLine(
  killed: { agents: number; shells: number } | null | undefined,
  t: PhaseTranslate,
): string | null {
  const total = count(killed?.agents) + count(killed?.shells);
  if (total === 0) return null;
  return t('claudeStatus.phase.killedBackground', { count: total },
    'Stopped: {{count}} background tasks killed, they will not continue on their own');
}

const PHASES: readonly RunPhase[] = ['running', 'waiting_helpers', 'parked'];

/** A `run_phase` frame off the socket, checked: unknown phase or no chat id → `null`. */
export function parseRunPhaseFrame(raw: unknown): RunPhaseFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as Record<string, unknown>;
  if (typeof frame.sessionId !== 'string' || !frame.sessionId) return null;
  if (!PHASES.includes(frame.phase as RunPhase)) return null;
  const background = (frame.background ?? {}) as { agents?: unknown; shells?: unknown };
  return {
    kind: 'run_phase',
    sessionId: frame.sessionId,
    provider: 'claude',
    phase: frame.phase as RunPhase,
    since: typeof frame.since === 'string' ? frame.since : '',
    background: { agents: count(background.agents), shells: count(background.shells) },
    ...(typeof frame.holdUntil === 'string' ? { holdUntil: frame.holdUntil } : {}),
  };
}

/** Adapts react-i18next's `t` (namespace «chat») to `PhaseTranslate`. */
export function phaseTranslate(t: (key: string, options: Record<string, unknown>) => string): PhaseTranslate {
  return (key, values, defaultValue) => t(key, { ...values, defaultValue });
}

/**
 * What a `run_phase` frame does to the session's activity. Between turns the main
 * agent runs no tool, so any step still «open» is a tool_result that never reached
 * us — the cause of a step timer like «Bash… 1ч07м» outliving the command: the
 * open steps are dropped (`resetSteps`) and the step/tool fields cleared.
 */
export function activityPatchForPhase(frame: RunPhaseFrame): {
  resetSteps: boolean;
  patch: { phase: RunPhaseFrame; step?: null; activityKind?: null; toolName?: null };
} {
  const between = isBetweenTurns(frame);
  return {
    resetSteps: between,
    patch: between ? { phase: frame, step: null, activityKind: null, toolName: null } : { phase: frame },
  };
}
