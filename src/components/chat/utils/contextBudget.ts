type Budget = Record<string, unknown>;
/** Missing readings retain the last snapshot; explicit null invalidates it. */
export function mergeContextBudget(previous: Budget | null, incoming: Budget): Budget {
  const next = { ...previous, ...incoming };
  if (!Object.prototype.hasOwnProperty.call(incoming, 'used')) next.used = previous?.used ?? null;
  else if (incoming.used !== null && !(typeof incoming.used === 'number' && Number.isFinite(incoming.used) && incoming.used >= 0)) {
    next.used = previous?.used ?? null;
  }
  return next;
}

/** Only attributed events for the currently viewed session may update its chip. */
export function applyContextBudgetEvent(previous: Budget | null, incoming: Budget, eventSessionId: unknown, activeSessionId: string | null): Budget | null {
  return typeof eventSessionId === 'string' && eventSessionId && eventSessionId === activeSessionId
    ? mergeContextBudget(previous, incoming) : previous;
}

/** Drafts are empty; opening another session is unknown until its own reading arrives. */
export function contextBudgetOnSessionChange(previous: Budget | null, previousSessionId: string | null, nextSessionId: string | null): Budget | null {
  if (previousSessionId === nextSessionId) return previous;
  return nextSessionId === null ? { used: 0 } : null;
}
