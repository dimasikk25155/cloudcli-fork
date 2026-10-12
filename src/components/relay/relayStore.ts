/**
 * Relay state that must outlive a component: which chat is collecting its
 * handoff note (survives navigating away and a reload — sessionStorage),
 * what "Не сейчас" was pressed at (per chat, localStorage), and the first
 * message waiting for a just-created continuation chat (in memory).
 */

import type { RelayDismissal } from './relayRules';

export type RelayPhase = 'idle' | 'collecting' | 'creating' | 'done' | 'error';

export type RelayState = {
  phase: RelayPhase;
  /** Tag of the request sent to the agent (collecting only). */
  nonce?: string;
  /** Identity of one creating run: a cancelled or timed-out run must not act later. */
  attempt?: string;
  /** done: the continuation chat, when it was created while another chat was open. */
  childId?: string;
  error?: string;
};

const IDLE: RelayState = { phase: 'idle' };
const STATE_KEY = (sessionId: string) => `neo3-relay:${sessionId}`;
const DISMISS_KEY = (sessionId: string) => `neo3-relay-dismissed:${sessionId}`;

const states = new Map<string, RelayState>();
const listeners = new Set<() => void>();
const pendingFirstMessages = new Map<string, string>();

function storage(kind: 'session' | 'local'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readPersisted(sessionId: string): RelayState {
  try {
    const raw = storage('session')?.getItem(STATE_KEY(sessionId));
    if (!raw) return IDLE;
    const parsed = JSON.parse(raw) as RelayState;
    return parsed?.phase === 'collecting' && typeof parsed.nonce === 'string' ? parsed : IDLE;
  } catch {
    return IDLE;
  }
}

export function getRelayState(sessionId: string | null): RelayState {
  if (!sessionId) return IDLE;
  let state = states.get(sessionId);
  if (!state) {
    state = readPersisted(sessionId);
    states.set(sessionId, state);
  }
  return state;
}

export function setRelayState(sessionId: string, next: RelayState): void {
  states.set(sessionId, next);
  try {
    // Only "waiting for the note" is worth surviving a reload: the turn keeps
    // running on the server and its reply is still there afterwards.
    if (next.phase === 'collecting') {
      storage('session')?.setItem(STATE_KEY(sessionId), JSON.stringify(next));
    } else {
      storage('session')?.removeItem(STATE_KEY(sessionId));
    }
  } catch {
    // Storage full / blocked: the in-memory state still drives this tab.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeRelay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const dismissals = new Map<string, RelayDismissal | null>();

function readStoredDismissal(sessionId: string): RelayDismissal | null {
  try {
    const raw = storage('local')?.getItem(DISMISS_KEY(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RelayDismissal>;
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return { contextPercent: num(parsed.contextPercent), usedTokens: num(parsed.usedTokens), ageHours: num(parsed.ageHours) };
  } catch {
    return null;
  }
}

/** What "Не сейчас" was pressed at in this chat (stable object between changes). */
export function getRelayDismissal(sessionId: string | null): RelayDismissal | null {
  if (!sessionId) return null;
  if (!dismissals.has(sessionId)) {
    dismissals.set(sessionId, readStoredDismissal(sessionId));
  }
  return dismissals.get(sessionId) ?? null;
}

export function writeRelayDismissal(sessionId: string, dismissal: RelayDismissal): void {
  dismissals.set(sessionId, dismissal);
  try {
    storage('local')?.setItem(DISMISS_KEY(sessionId), JSON.stringify(dismissal));
  } catch {
    // Not persisted → this tab still remembers it until a reload.
  }
  listeners.forEach((listener) => listener());
}

let openSessionId: string | null = null;

/** The chat currently open in the composer (the relay band reports it). */
export function setOpenRelaySession(sessionId: string | null): void {
  openSessionId = sessionId;
}

export function getOpenRelaySession(): string | null {
  return openSessionId;
}

/** The continuation chat's first message, delivered once that chat is open. */
export function setPendingFirstMessage(sessionId: string, text: string): void {
  pendingFirstMessages.set(sessionId, text);
}

export function takePendingFirstMessage(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const text = pendingFirstMessages.get(sessionId) ?? null;
  pendingFirstMessages.delete(sessionId);
  return text;
}

export function hasPendingFirstMessage(sessionId: string | null): boolean {
  return Boolean(sessionId && pendingFirstMessages.has(sessionId));
}
