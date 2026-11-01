import type { SessionStep } from '../../../hooks/useSessionProtection';

/** Shell steps turn red after 2 minutes, every other step after 5. */
export const COMMAND_STEP_LIMIT_MS = 2 * 60_000;
export const OTHER_STEP_LIMIT_MS = 5 * 60_000;

const COMMAND_TOOL = /^(bash|shell|powershell|exec_command|command|local_shell)$/i;

export function stepLimitMs(name: string): number {
  return COMMAND_TOOL.test(name.trim()) ? COMMAND_STEP_LIMIT_MS : OTHER_STEP_LIMIT_MS;
}

export function isStepOverdue(step: SessionStep | null | undefined, now: number): boolean {
  return Boolean(step) && now - step!.startedAt >= stepLimitMs(step!.name);
}

/**
 * Open top-level tool calls of one session, oldest first. The indicator shows
 * the oldest: that is the step the turn is waiting on.
 */
export class OpenSteps {
  private readonly open = new Map<string, SessionStep>();
  private readonly finished = new Set<string>();

  update(toolId: string, name: string, status: unknown, now: number): SessionStep | null {
    return ['completed', 'failed', 'cancelled', 'canceled', 'succeeded'].includes(String(status))
      ? this.finish(toolId)
      : this.start(toolId, name, now);
  }

  start(toolId: string, name: string, now: number): SessionStep | null {
    if (!this.finished.has(toolId) && !this.open.has(toolId)) this.open.set(toolId, { name, startedAt: now });
    return this.current();
  }

  finish(toolId: string): SessionStep | null {
    this.finished.add(toolId);
    this.open.delete(toolId);
    return this.current();
  }

  current(): SessionStep | null {
    const first = this.open.values().next();
    return first.done ? null : first.value;
  }
}

// Open steps per session. Reset when a turn ends (`complete`) AND when a new
// one starts: a run that died without `complete` must not leave a red timer.
const sessionSteps = new Map<string, OpenSteps>();

export function stepsFor(sessionId: string): OpenSteps {
  let steps = sessionSteps.get(sessionId);
  if (!steps) {
    steps = new OpenSteps();
    sessionSteps.set(sessionId, steps);
  }
  return steps;
}

export function resetSessionSteps(sessionId: string): void {
  sessionSteps.delete(sessionId);
}

/** «14с», «2м 05с», «1ч 03м». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}ч ${String(minutes).padStart(2, '0')}м`;
  if (minutes > 0) return `${minutes}м ${String(seconds).padStart(2, '0')}с`;
  return `${seconds}с`;
}
