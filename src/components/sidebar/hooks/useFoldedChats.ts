/**
 * Which parents of the sidebar's chat tree are folded — on this device
 * (localStorage `neo3.sidebar.foldedChats`), shared by every project list.
 */
import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'neo3.sidebar.foldedChats';
const MAX_KEPT = 500;

const listeners = new Set<() => void>();
let folded: ReadonlySet<string> = readStored();

function readStored(): ReadonlySet<string> {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function toggle(sessionId: string): void {
  const next = new Set(folded);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  folded = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next].slice(-MAX_KEPT)));
  } catch {
    // Folding still works for this page.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => folded;

export function useFoldedChats(): { folded: ReadonlySet<string>; toggleFolded: (sessionId: string) => void } {
  const current = useSyncExternalStore(subscribe, read, read);
  const toggleFolded = useCallback((sessionId: string) => toggle(sessionId), []);
  return { folded: current, toggleFolded };
}
