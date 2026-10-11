/**
 * Client state of vault-note suggestions ("Агент предлагает заметку").
 *
 * Holds the open suggestions from `GET /api/memory-suggestions` plus the ones
 * written in this tab (so the card can show where the note went until it is
 * closed). Free of browser/API imports — the tab-wide instance with real
 * fetches lives in `useMemorySuggestions.ts`.
 */

export type MemorySuggestion = {
  id: number;
  sessionId: string;
  sessionTitle: string | null;
  projectName: string | null;
  title: string;
  folder: string;
  body: string;
  createdAt: string;
};

export type MemoryEntry = {
  suggestion: MemorySuggestion;
  /** Absolute path of the written note, once «Записать» succeeded. */
  writtenPath: string | null;
  busy: 'write' | 'dismiss' | null;
  error: string | null;
};

export type MemorySnapshot = {
  entries: MemoryEntry[];
  /** Suggestions still waiting for a decision. */
  pendingCount: number;
  loaded: boolean;
};

export type MemoryStoreDeps = {
  fetchList: () => Promise<MemorySuggestion[]>;
  postWrite: (id: number) => Promise<{ path: string }>;
  postDismiss: (id: number) => Promise<void>;
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createMemorySuggestionsStore(deps: MemoryStoreDeps) {
  let open: MemorySuggestion[] = [];
  /** Written (or failed) in this tab, keyed by id; survives refreshes until closed. */
  const local = new Map<number, MemoryEntry>();
  let loaded = false;
  let snapshot: MemorySnapshot = { entries: [], pendingCount: 0, loaded: false };
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(): void {
    const entries: MemoryEntry[] = open.map((suggestion) => local.get(suggestion.id) ?? {
      suggestion,
      writtenPath: null,
      busy: null,
      error: null,
    });
    for (const entry of local.values()) {
      if (!open.some((suggestion) => suggestion.id === entry.suggestion.id)) {
        entries.push(entry);
      }
    }
    snapshot = {
      entries,
      pendingCount: entries.filter((entry) => entry.writtenPath === null).length,
      loaded,
    };
    listeners.forEach((listener) => listener());
  }

  function patch(entry: MemoryEntry, changes: Partial<MemoryEntry>): void {
    local.set(entry.suggestion.id, { ...entry, ...changes });
    publish();
  }

  function find(id: number): MemoryEntry | undefined {
    return snapshot.entries.find((entry) => entry.suggestion.id === id);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    refresh(): Promise<void> {
      if (!inFlight) {
        inFlight = deps.fetchList()
          .then((list) => {
            open = list;
            loaded = true;
            // A suggestion closed elsewhere (other tab) drops its pending local state.
            for (const [id, entry] of local) {
              if (entry.writtenPath === null && !list.some((suggestion) => suggestion.id === id)) {
                local.delete(id);
              }
            }
            publish();
          })
          .catch(() => {
            // Best effort: keep what is shown.
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },

    forSession(sessionId: string): MemoryEntry[] {
      return snapshot.entries.filter((entry) => entry.suggestion.sessionId === sessionId);
    },

    async write(id: number): Promise<void> {
      const entry = find(id);
      if (!entry || entry.busy || entry.writtenPath) return;
      patch(entry, { busy: 'write', error: null });
      try {
        const { path } = await deps.postWrite(id);
        patch(entry, { busy: null, error: null, writtenPath: path });
      } catch (error) {
        patch(entry, { busy: null, error: errorText(error, 'Не получилось записать') });
      }
    },

    /** «Не надо» for an open suggestion; for a written one just closes the card. */
    async dismiss(id: number): Promise<void> {
      const entry = find(id);
      if (!entry || entry.busy) return;
      if (entry.writtenPath) {
        local.delete(id);
        publish();
        return;
      }
      patch(entry, { busy: 'dismiss', error: null });
      try {
        await deps.postDismiss(id);
        local.delete(id);
        open = open.filter((suggestion) => suggestion.id !== id);
        publish();
      } catch (error) {
        patch(entry, { busy: null, error: errorText(error, 'Не получилось убрать') });
      }
    },
  };
}

export type MemorySuggestionsStore = ReturnType<typeof createMemorySuggestionsStore>;
