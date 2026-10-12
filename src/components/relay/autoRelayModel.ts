/**
 * «Авто-перенос» on the client — pure rules: what the relay band shows for
 * the server's auto-relay status, and when the open tab follows the chat to
 * its continuation. The move itself happens on the server.
 */

export type AutoRelayState = 'collecting' | 'creating' | 'done' | 'failed';

/** Mirror of the server's AutoRelayStatus (GET /api/sessions/:id/auto-relay, WS `auto_relay`). */
export type AutoRelayStatus = {
  sessionId: string;
  enabled: boolean;
  state: AutoRelayState | null;
  childSessionId: string | null;
  childTitle: string | null;
  error: string | null;
};

/**
 * - `moving`: the server is moving the chat («Переношу…»);
 * - `moved`: done, the continuation exists («Перенёс → Открыть»);
 * - `failed`: told once, the switch went off;
 * - `armed`: the switch is on, nothing to do yet;
 * - `off`: nothing of the auto-relay to show.
 */
export type AutoRelayBandMode = 'moving' | 'moved' | 'failed' | 'armed' | 'off';

export function autoRelayBandMode(status: AutoRelayStatus | null | undefined): AutoRelayBandMode {
  if (!status) return 'off';
  if (status.state === 'collecting' || status.state === 'creating') return 'moving';
  if (status.state === 'done' && status.childSessionId) return 'moved';
  if (status.state === 'failed') return 'failed';
  return status.enabled ? 'armed' : 'off';
}

/**
 * The open chat follows its continuation only when the move finished while
 * this tab was watching it move — opening an old, already moved chat later
 * stays on it (the band offers «Открыть» instead).
 */
export function shouldFollowMove(
  previous: AutoRelayStatus | null | undefined,
  next: AutoRelayStatus,
  openSessionId: string | null,
): string | null {
  if (!openSessionId || next.sessionId !== openSessionId) return null;
  if (next.state !== 'done' || !next.childSessionId) return null;
  if (!previous || previous.sessionId !== next.sessionId) return null;
  return previous.state === 'collecting' || previous.state === 'creating' ? next.childSessionId : null;
}

/** A status frame/body from the server, or null when it is not one. */
export function readAutoRelayStatus(value: unknown): AutoRelayStatus | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) return null;
  const state = raw.state === 'collecting' || raw.state === 'creating' || raw.state === 'done' || raw.state === 'failed'
    ? raw.state
    : null;
  const text = (input: unknown) => (typeof input === 'string' && input ? input : null);
  return {
    sessionId: raw.sessionId,
    enabled: raw.enabled === true,
    state,
    childSessionId: text(raw.childSessionId),
    childTitle: text(raw.childTitle),
    error: text(raw.error),
  };
}
