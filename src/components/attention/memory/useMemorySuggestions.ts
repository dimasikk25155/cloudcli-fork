import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '../../auth';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { GatewayEventKind } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import { useModEnabled } from '../../../hooks/useModEnabled';

import { createMemorySuggestionsStore, type MemoryEntry, type MemorySnapshot, type MemorySuggestion } from './memorySuggestionsStore';

/** Safety-net poll while something shows suggestions (a missed WS frame). */
const MEMORY_POLL_MS = 5 * 60_000;
const MEMORY_CHANGED: GatewayEventKind = 'memory_suggestions_changed';

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error) {
      return new Error(payload.error);
    }
  } catch {
    // Not JSON — use the fallback.
  }
  return new Error(fallback);
}

export const memorySuggestionsStore = createMemorySuggestionsStore({
  async fetchList() {
    const response = await authenticatedFetch('/api/memory-suggestions');
    if (!response.ok) {
      throw await errorFrom(response, 'Не удалось загрузить предложения');
    }
    const payload = (await response.json()) as { suggestions?: unknown };
    return Array.isArray(payload.suggestions) ? (payload.suggestions as MemorySuggestion[]) : [];
  },
  async postWrite(id) {
    const response = await authenticatedFetch(`/api/memory-suggestions/${id}/write`, { method: 'POST' });
    if (!response.ok) {
      throw await errorFrom(response, 'Не получилось записать');
    }
    return (await response.json()) as { path: string };
  },
  async postDismiss(id) {
    const response = await authenticatedFetch(`/api/memory-suggestions/${id}/dismiss`, { method: 'POST' });
    if (!response.ok) {
      throw await errorFrom(response, 'Не получилось убрать');
    }
  },
});

const subscribeStore = (listener: () => void) => memorySuggestionsStore.subscribe(listener);
const readSnapshot = (): MemorySnapshot => memorySuggestionsStore.getSnapshot();
const EMPTY: MemorySnapshot = { entries: [], pendingCount: 0, loaded: false };
const readEmpty = () => EMPTY;
const subscribeNothing = () => () => {};

/**
 * Vault-note suggestions for the current user. Admin-only feature: for anyone
 * else it is an empty list and nothing is fetched. Every consumer keeps the
 * shared store fresh (WS frame + slow poll); refreshes are de-duplicated.
 */
export function useMemorySuggestions() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // «Заметки в Obsidian» off: no banner, no hub section, no polling.
  const memoryNotesOn = useModEnabled('modMemoryNotes');
  const active = isAdmin && memoryNotesOn;
  const { subscribe } = useWebSocket();
  const snapshot = useSyncExternalStore(
    active ? subscribeStore : subscribeNothing,
    active ? readSnapshot : readEmpty,
    active ? readSnapshot : readEmpty,
  );

  useEffect(() => {
    if (!active) return undefined;
    void memorySuggestionsStore.refresh();
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === MEMORY_CHANGED || event.kind === 'websocket_reconnected') {
        void memorySuggestionsStore.refresh();
      }
    });
    const interval = window.setInterval(() => void memorySuggestionsStore.refresh(), MEMORY_POLL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [active, subscribe]);

  const write = useCallback((id: number) => memorySuggestionsStore.write(id), []);
  const dismiss = useCallback((id: number) => memorySuggestionsStore.dismiss(id), []);
  return { ...snapshot, isAdmin, write, dismiss };
}

/** Entries of one session (the banner over the composer). */
export function useSessionMemorySuggestions(sessionId: string | null | undefined): {
  entries: MemoryEntry[];
  write: (id: number) => Promise<void>;
  dismiss: (id: number) => Promise<void>;
} {
  const { entries, write, dismiss } = useMemorySuggestions();
  return {
    entries: sessionId ? entries.filter((entry) => entry.suggestion.sessionId === sessionId) : [],
    write,
    dismiss,
  };
}
