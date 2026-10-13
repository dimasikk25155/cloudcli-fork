/**
 * Runs the server starts for its own purposes that are not news for the
 * person: today the auto-relay's handoff request (its outcome has its own
 * push). Keyed by app session id, bound to the run that set it — a person's
 * own turn in the same chat is never covered.
 */

const turns = new Map<string, symbol>();

/** Marks the session's current run as a service turn; returns the release for its end. */
export function beginServiceTurn(appSessionId: string): () => void {
  const token = Symbol(appSessionId);
  turns.set(appSessionId, token);
  return () => {
    if (turns.get(appSessionId) === token) turns.delete(appSessionId);
  };
}

export function isServiceTurn(appSessionId: string | null | undefined): boolean {
  return Boolean(appSessionId && turns.has(appSessionId));
}
