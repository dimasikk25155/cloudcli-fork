/**
 * Relay state that must outlive a component: a refused «Перенести» (per chat,
 * in memory) and what "Не сейчас" was pressed at (per chat, localStorage).
 * The move in progress lives on the server (auto-relay status).
 */

import type { RelayDismissal } from './relayRules';

export type RelayPhase = 'idle' | 'error';

export type RelayState = {
  phase: RelayPhase;
  error?: string;
};

const IDLE: RelayState = { phase: 'idle' };
const DISMISS_KEY = (sessionId: string) => `neo3-relay-dismissed:${sessionId}`;

const states = new Map<string, RelayState>();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getRelayState(sessionId: string | null): RelayState {
  if (!sessionId) return IDLE;
  return states.get(sessionId) ?? IDLE;
}

export function setRelayState(sessionId: string, next: RelayState): void {
  states.set(sessionId, next);
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
    const raw = storage()?.getItem(DISMISS_KEY(sessionId));
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
    storage()?.setItem(DISMISS_KEY(sessionId), JSON.stringify(dismissal));
  } catch {
    // Not persisted → this tab still remembers it until a reload.
  }
  listeners.forEach((listener) => listener());
}
