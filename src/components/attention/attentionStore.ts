import type { AttentionCounts, AttentionItem, AttentionSeenTarget } from './types';
import { applySeen, countAttention, isSeenable } from './utils/attentionModel';

/**
 * Client state of "Ждут тебя": the list from `GET /api/attention`, the derived
 * counter N and the "просмотрено" writes. The tab-wide instance lives in `useAttention.ts`;
 * this module stays free of browser/API imports so it can be unit-tested.
 */

export type AttentionSnapshot = {
  items: AttentionItem[];
  /** Same elements keyed by session id (sidebar rows look themselves up here). */
  byId: ReadonlyMap<string, AttentionItem>;
  counts: AttentionCounts;
  /** N = waiting + unread failed + unread done. */
  total: number;
  /** True after the first successful load. */
  loaded: boolean;
};

export type AttentionStoreDeps = {
  fetchList: () => Promise<AttentionItem[]>;
  postSeen: (target: AttentionSeenTarget) => Promise<void>;
  /** The open session only counts as "looked at" while the page is visible. */
  isPageVisible: () => boolean;
};

function snapshotOf(items: AttentionItem[], loaded: boolean): AttentionSnapshot {
  const { total, counts } = countAttention(items);
  const byId = new Map(items.map((entry) => [entry.sessionId, entry] as const));
  return { items, byId, counts, total, loaded };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * Structural sharing: an element equal to the one already held keeps the old
 * reference, so per-session subscribers (sidebar rows) see no change. Returns
 * the previous array itself when nothing changed at all.
 */
function reconcileItems(previous: AttentionItem[], previousById: ReadonlyMap<string, AttentionItem>, next: AttentionItem[]): AttentionItem[] {
  let changed = previous.length !== next.length;
  const merged = next.map((entry, index) => {
    const known = previousById.get(entry.sessionId);
    const kept = known && sameValue(known, entry) ? known : entry;
    if (kept !== previous[index]) changed = true;
    return kept;
  });
  return changed ? merged : previous;
}

export function createAttentionStore(deps: AttentionStoreDeps) {
  let snapshot: AttentionSnapshot = snapshotOf([], false);
  let viewedSessionId: string | null = null;
  // Bumped by every local "seen" write: a list fetched before the write is
  // stale (it still says unread) and must not overwrite the optimistic state.
  let seenGeneration = 0;
  let inFlight: Promise<void> | null = null;
  let rerun = false;
  const listeners = new Set<() => void>();

  const publish = (items: AttentionItem[], loaded = snapshot.loaded) => {
    const reconciled = reconcileItems(snapshot.items, snapshot.byId, items);
    if (reconciled === snapshot.items && loaded === snapshot.loaded) {
      return;
    }
    snapshot = snapshotOf(reconciled, loaded);
    listeners.forEach((listener) => listener());
  };

  const needsSeen = (sessionId: string | null): sessionId is string => {
    if (!sessionId) return false;
    const entry = snapshot.byId.get(sessionId);
    return Boolean(entry && entry.unread && isSeenable(entry));
  };

  async function markSeen(target: AttentionSeenTarget): Promise<void> {
    seenGeneration += 1;
    publish(applySeen(snapshot.items, target));
    try {
      await deps.postSeen(target);
    } catch (error) {
      console.warn('[attention] Не удалось отметить просмотренным:', error);
    }
  }

  async function markViewedIfNeeded(): Promise<void> {
    if (needsSeen(viewedSessionId) && deps.isPageVisible()) {
      await markSeen({ sessionIds: [viewedSessionId] });
    }
  }

  async function loadOnce(): Promise<void> {
    const generation = seenGeneration;
    const items = await deps.fetchList();
    if (generation !== seenGeneration) {
      // A seen-write raced this fetch; read again so the server state wins.
      rerun = true;
      return;
    }
    publish(items, true);
    await markViewedIfNeeded();
  }

  async function refresh(): Promise<void> {
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          rerun = false;
          await loadOnce();
        } while (rerun);
      } catch (error) {
        console.warn('[attention] Не удалось загрузить статусы сессий:', error);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    getSnapshot: (): AttentionSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    markSeen,
    /** The session on screen (null = none). Opening a session marks it seen. */
    setViewedSession(sessionId: string | null): Promise<void> {
      viewedSessionId = sessionId;
      return markViewedIfNeeded();
    },
    /** Page became visible again: the open session counts as looked at. */
    pageBecameVisible(): Promise<void> {
      return markViewedIfNeeded();
    },
  };
}

export type AttentionStore = ReturnType<typeof createAttentionStore>;
