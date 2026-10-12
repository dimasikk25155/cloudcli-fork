import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { lastReplyTurn, type ReplyTurnMessage } from '../../../shared/reply-turn';
import type { SessionLinks } from '../../../shared/session-links';
import { sendToComposer } from '../../utils/composerDraft';

import { verifyHandoffFile } from './relayApi';
import {
  buildRelayFirstMessage,
  buildRelayRequest,
  parseHandoffFile,
  relayMeasures,
  relayRequestTag,
  relaySuggestion,
  type RelayReason,
} from './relayRules';
import {
  getOpenRelaySession,
  getRelayDismissal,
  getRelayState,
  hasPendingFirstMessage,
  setOpenRelaySession,
  setPendingFirstMessage,
  setRelayState,
  subscribeRelay,
  takePendingFirstMessage,
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
  /** Normalized store messages of this chat (for the last reply). */
  messages: ReplyTurnMessage[];
};

/** Engine, model and thinking level of the chat being relayed. */
export type RelayEngine = { provider: string; model: string; effort: string };

export type RelayChatDeps = {
  /** The open chat's engine/model/effort — the continuation chat starts on the same. */
  engine: RelayEngine;
  /**
   * Creates the continuation chat in the same project on `engine`, linked as
   * relay, and records its model once; resolves its id.
   */
  createChat: (parentSessionId: string, engine: RelayEngine) => Promise<string>;
  /** Opens a chat created by createChat (no second model write). */
  openChat: (sessionId: string) => void;
};

export type RelaySuggestion = {
  show: boolean;
  reason: RelayReason | null;
  /** 0–100 context share for the band text; null = unknown. */
  contextPercent: number | null;
  state: RelayState;
  start: () => void;
  dismiss: () => void;
  /** Leaves an error / gives up waiting for the note or for the new chat. */
  reset: () => void;
  /** done while another chat was open: opens the continuation chat. */
  openChild: () => void;
};

const MINUTE_MS = 60_000;
/** Checking the note + creating the chat; past this the band reports an error instead of spinning. */
export const RELAY_CREATE_TIMEOUT_MS = 60_000;

function newNonce(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * The relay band's brain. Decides when the band shows (relayRules), sends the
 * handoff request through the composer (the ordinary send path — secret guard
 * included), waits for that turn to finish, reads `HANDOFF_FILE:` from the
 * last reply, has the server check the file, then creates the linked
 * continuation chat and hands it its first message.
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
    && (state.phase === 'done'
      ? Boolean(state.childId)
      : state.phase !== 'idle' || (verdict.show && !session.isProcessing && !alreadyContinued));

  // Which chat is open — the relay only jumps to the new chat from its parent.
  useEffect(() => {
    setOpenRelaySession(sessionId);
    return () => {
      if (getOpenRelaySession() === sessionId) setOpenRelaySession(null);
    };
  }, [sessionId]);

  const start = useCallback(() => {
    if (!sessionId) return;
    const current = getRelayState(sessionId);
    if (current.phase === 'collecting' || current.phase === 'creating') return;
    const nonce = newNonce();
    setRelayState(sessionId, { phase: 'collecting', nonce });
    sendToComposer(buildRelayRequest(nonce), { autoSend: true });
  }, [sessionId]);

  const dismiss = useCallback(() => {
    if (!sessionId) return;
    writeRelayDismissal(sessionId, measures);
  }, [sessionId, measures]);

  const reset = useCallback(() => {
    if (!sessionId) return;
    setRelayState(sessionId, { phase: 'idle' });
  }, [sessionId]);

  const depsRef = useRef(deps);
  depsRef.current = deps;

  const openChild = useCallback(() => {
    if (!sessionId) return;
    const { childId } = getRelayState(sessionId);
    if (!childId) return;
    setRelayState(sessionId, { phase: 'done' });
    depsRef.current.openChat(childId);
  }, [sessionId]);

  // The handoff turn ended: the last reply answers OUR request (its tag is in
  // the user message) and nothing is running → finish the relay.
  useEffect(() => {
    if (!sessionId || state.phase !== 'collecting' || !state.nonce || session.isProcessing) return;
    const turn = lastReplyTurn(session.messages);
    if (!turn || !turn.user.includes(relayRequestTag(state.nonce))) return;

    const handoffPath = parseHandoffFile(turn.assistant);
    if (!handoffPath) {
      setRelayState(sessionId, {
        phase: 'error',
        error: 'Агент не вывел строку HANDOFF_FILE — записку не нашёл. Новый чат не создан.',
      });
      return;
    }

    // Everything the chain needs is fixed here, while the parent is the open
    // chat: navigating elsewhere mid-way must not change engine, model or target.
    const parentId = sessionId;
    const chainDeps = depsRef.current;
    const engine = { ...chainDeps.engine };
    const attempt = newNonce();
    const isMine = (phases: string[]) => {
      const current = getRelayState(parentId);
      return current.attempt === attempt && phases.includes(current.phase);
    };
    setRelayState(parentId, { phase: 'creating', attempt });
    const timer = window.setTimeout(() => {
      if (isMine(['creating'])) {
        setRelayState(parentId, {
          phase: 'error',
          attempt,
          error: 'Новый чат не открылся за минуту. Проверь список чатов — он мог создаться.',
        });
      }
    }, RELAY_CREATE_TIMEOUT_MS);
    void (async () => {
      try {
        const absPath = await verifyHandoffFile(parentId, handoffPath);
        if (!isMine(['creating'])) return; // cancelled or timed out: create nothing
        const childId = await chainDeps.createChat(parentId, engine);
        setPendingFirstMessage(childId, buildRelayFirstMessage(absPath));
        // Cancelled meanwhile: the chat exists (and is linked) but nobody is taken there.
        if (!isMine(['creating', 'error'])) return;
        // Jump only from the parent and only while still waiting; after a timeout
        // the band offers «Открыть» instead of moving the user unasked.
        if (getOpenRelaySession() === parentId && isMine(['creating'])) {
          setRelayState(parentId, { phase: 'done' });
          chainDeps.openChat(childId);
        } else {
          setRelayState(parentId, { phase: 'done', childId });
        }
      } catch (error) {
        if (!isMine(['creating'])) return;
        const message = error instanceof Error && error.message ? error.message : 'Неизвестная ошибка';
        setRelayState(parentId, { phase: 'error', attempt, error: `${message}. Новый чат не создан.` });
      } finally {
        window.clearTimeout(timer);
      }
    })();
  }, [sessionId, state, session.isProcessing, session.messages]);

  return {
    show,
    reason: verdict.reason,
    contextPercent: measures.contextPercent === null ? null : Math.round(measures.contextPercent),
    state,
    start,
    dismiss,
    reset,
    openChild,
  };
}

/**
 * Delivers a continuation chat's first message once that chat is the open
 * one and idle — through the composer, like a typed message.
 */
export function useRelayFirstMessage(activeSessionId: string | null, isProcessing: boolean): void {
  useEffect(() => {
    if (!activeSessionId || isProcessing || !hasPendingFirstMessage(activeSessionId)) return;
    const text = takePendingFirstMessage(activeSessionId);
    if (text) {
      sendToComposer(text, { autoSend: true });
    }
  }, [activeSessionId, isProcessing]);
}
