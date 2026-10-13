import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { SessionLinks } from '../../../shared/session-links';

import { relayMeasures, relaySuggestion, type RelayReason } from './relayRules';
import {
  getRelayDismissal,
  getRelayState,
  setRelayState,
  subscribeRelay,
  writeRelayDismissal,
  type RelayState,
} from './relayStore';

export type RelaySession = {
  id: string | null;
  createdAt?: string | number | null;
  links?: SessionLinks | null;
  /** Latest occupied context (same number TokenUsageSummary shows). */
  usedTokens: number | null;
  /** Selected model's window; null = unknown. */
  contextWindow: number | null;
  isProcessing: boolean;
};

export type RelayChatDeps = {
  /**
   * Starts the move on the server (POST …/auto-relay/start). The server sends
   * the handoff request, reads the note, creates and starts the continuation;
   * the tab follows by the `auto_relay` frames. Rejects with the reason.
   */
  startMove: () => Promise<void>;
};

export type RelaySuggestion = {
  show: boolean;
  reason: RelayReason | null;
  /** 0–100 context share for the band text; null = unknown. */
  contextPercent: number | null;
  state: RelayState;
  start: () => void;
  dismiss: () => void;
  /** Leaves an error. */
  reset: () => void;
};

const MINUTE_MS = 60_000;

/**
 * The relay band's brain on the client: decides when the band shows
 * (relayRules) and asks the server to move the chat. The move itself —
 * request, note, continuation — runs on the server (auto-relay module), so a
 * closed, reloaded or navigated tab cannot lose it halfway.
 */
export function useRelaySuggestion(session: RelaySession, deps: RelayChatDeps): RelaySuggestion {
  const sessionId = session.id;
  const state = useSyncExternalStore(
    subscribeRelay,
    () => getRelayState(sessionId),
    () => getRelayState(sessionId),
  );
  const dismissed = useSyncExternalStore(
    subscribeRelay,
    () => getRelayDismissal(sessionId),
    () => null,
  );

  // Age crosses its threshold with no other change; re-check once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const verdict = useMemo(() => relaySuggestion({
    usedTokens: session.usedTokens,
    contextWindow: session.contextWindow,
    createdAt: session.createdAt ?? null,
    now,
    dismissed,
  }), [session.usedTokens, session.contextWindow, session.createdAt, now, dismissed]);

  const measures = useMemo(() => relayMeasures({
    usedTokens: session.usedTokens,
    contextWindow: session.contextWindow,
    createdAt: session.createdAt ?? null,
    now,
  }), [session.usedTokens, session.contextWindow, session.createdAt, now]);

  const alreadyContinued = Boolean(session.links?.children?.some((child) => child.relation === 'relay'));
  const show = Boolean(sessionId)
    && (state.phase !== 'idle' || (verdict.show && !session.isProcessing && !alreadyContinued));

  const { startMove } = deps;
  const start = useCallback(() => {
    if (!sessionId) return;
    setRelayState(sessionId, { phase: 'idle' });
    startMove().catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : 'Неизвестная ошибка';
      setRelayState(sessionId, { phase: 'error', error: message });
    });
  }, [sessionId, startMove]);

  const dismiss = useCallback(() => {
    if (!sessionId) return;
    writeRelayDismissal(sessionId, measures);
  }, [sessionId, measures]);

  const reset = useCallback(() => {
    if (!sessionId) return;
    setRelayState(sessionId, { phase: 'idle' });
  }, [sessionId]);

  return {
    show,
    reason: verdict.reason,
    contextPercent: measures.contextPercent === null ? null : Math.round(measures.contextPercent),
    state,
    start,
    dismiss,
    reset,
  };
}
