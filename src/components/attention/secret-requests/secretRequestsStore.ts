/**
 * Client state of «Запрос ключа» cards in «Ждут тебя».
 *
 * Holds the open requests from `GET /api/secret-requests` (names and reasons
 * only) and the per-card state of «Сохранить»/«Отказать». The value is never
 * stored here: `answer` passes it straight to the POST and forgets it.
 * Free of browser/API imports — the tab-wide instance with real fetches lives
 * in `useSecretRequests.ts`.
 */

export type SecretRequest = {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  name: string;
  why: string;
  createdAt: string;
  /** The secrets file already has this name: saving needs «Заменить». */
  exists: boolean;
};

export type SecretRequestEntry = {
  request: SecretRequest;
  busy: 'save' | 'decline' | null;
  error: string | null;
};

export type SecretRequestsSnapshot = {
  entries: SecretRequestEntry[];
  /** «NAME сохранён в файле секретов» after the last save, for a short note. */
  lastMessage: string | null;
  loaded: boolean;
};

export type SecretRequestsStoreDeps = {
  fetchList: () => Promise<SecretRequest[]>;
  postAnswer: (id: string, body: { value: string; replace: boolean }) => Promise<{ name: string; message: string }>;
  postDecline: (id: string) => Promise<void>;
};

export function secretCardTitle(request: SecretRequest): string {
  return `Агент просит ключ ${request.name}: ${request.why}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createSecretRequestsStore(deps: SecretRequestsStoreDeps) {
  let open: SecretRequest[] = [];
  const state = new Map<string, Omit<SecretRequestEntry, 'request'>>();
  let lastMessage: string | null = null;
  let loaded = false;
  let snapshot: SecretRequestsSnapshot = { entries: [], lastMessage: null, loaded: false };
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function publish(): void {
    snapshot = {
      entries: open.map((request) => ({ request, ...(state.get(request.id) ?? { busy: null, error: null }) })),
      lastMessage,
      loaded,
    };
    listeners.forEach((listener) => listener());
  }

  function mark(id: string, busy: SecretRequestEntry['busy'], error: string | null): void {
    state.set(id, { busy, error });
    publish();
  }

  function drop(id: string): void {
    open = open.filter((request) => request.id !== id);
    state.delete(id);
  }

  async function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        open = await deps.fetchList();
        for (const id of [...state.keys()]) if (!open.some((request) => request.id === id)) state.delete(id);
        loaded = true;
        publish();
      } catch {
        // A failed re-read keeps the cards shown; the next frame or poll retries.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function answer(id: string, value: string, replace: boolean): Promise<void> {
    mark(id, 'save', null);
    try {
      const result = await deps.postAnswer(id, { value, replace });
      lastMessage = result.message;
      drop(id);
      publish();
    } catch (error) {
      mark(id, null, errorText(error, 'Не получилось сохранить ключ'));
    }
  }

  async function decline(id: string): Promise<void> {
    mark(id, 'decline', null);
    try {
      await deps.postDecline(id);
      drop(id);
      publish();
    } catch (error) {
      mark(id, null, errorText(error, 'Не получилось отказать'));
    }
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: (): SecretRequestsSnapshot => snapshot,
    refresh,
    answer,
    decline,
  };
}

export type SecretRequestsStore = ReturnType<typeof createSecretRequestsStore>;
