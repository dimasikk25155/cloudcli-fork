import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { GatewayEventKind } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';
import { setPageAttentionCount } from '../../utils/pageTitleNotification';
import { setPromptCacheTtlMin } from '../../utils/promptCache';

import { createAttentionStore, type AttentionSnapshot } from './attentionStore';
import type { AttentionItem, AttentionSeenTarget } from './types';
import { useModEnabled } from '../../hooks/useModEnabled';

import { applyAppBadge } from './utils/appBadge';
import { attentionCountShown, attentionStatusesNeeded } from './utils/attentionMods';

/** Safety-net poll in case an `attention_changed` frame was missed (Решение 5). */
export const ATTENTION_POLL_MS = 20_000;

const ATTENTION_CHANGED: GatewayEventKind = 'attention_changed';

async function fetchAttentionList(): Promise<AttentionItem[]> {
  const response = await authenticatedFetch('/api/attention');
  if (!response.ok) {
    throw new Error(`GET /api/attention → ${response.status}`);
  }
  const payload = (await response.json()) as { items?: unknown; promptCacheTtlMin?: unknown };
  // The prompt-cache timer's TTL (server env NEO3_PROMPT_CACHE_TTL_MIN) rides along.
  setPromptCacheTtlMin(payload.promptCacheTtlMin);
  return Array.isArray(payload.items) ? (payload.items as AttentionItem[]) : [];
}

async function postAttentionSeen(target: AttentionSeenTarget): Promise<void> {
  const response = await authenticatedFetch('/api/attention/seen', {
    method: 'POST',
    body: JSON.stringify(target),
  });
  if (!response.ok) {
    throw new Error(`POST /api/attention/seen → ${response.status}`);
  }
}

/** The tab-wide "Ждут тебя" store. */
export const attentionStore = createAttentionStore({
  fetchList: fetchAttentionList,
  postSeen: postAttentionSeen,
  isPageVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
});

const subscribeStore = (listener: () => void) => attentionStore.subscribe(listener);
const readSnapshot = (): AttentionSnapshot => attentionStore.getSnapshot();

/** `{items, counts, total, loaded, markSeen, refresh}` — re-renders on every change. */
export function useAttention() {
  const snapshot = useSyncExternalStore(subscribeStore, readSnapshot, readSnapshot);
  const markSeen = useCallback((target: AttentionSeenTarget) => attentionStore.markSeen(target), []);
  const refresh = useCallback(() => attentionStore.refresh(), []);
  return { ...snapshot, markSeen, refresh };
}

/** Status of one session, for the sidebar dot. Undefined when the server has none. */
export function useAttentionItem(sessionId: string | null | undefined): AttentionItem | undefined {
  const read = useCallback(
    () => (sessionId ? attentionStore.getSnapshot().byId.get(sessionId) : undefined),
    [sessionId],
  );
  return useSyncExternalStore(subscribeStore, read, read);
}

/**
 * Mount once at the app shell: loads the list, re-reads on the websocket
 * `attention_changed` frame (and after reconnects), polls every 20 s, keeps
 * the tab title «(N)» and the app-icon badge in sync, and tells the store
 * which session is on screen so opening it marks it seen.
 */
export function useAttentionSync(viewedSessionId: string | null): void {
  const { subscribe } = useWebSocket();
  const attentionOn = useModEnabled('modAttention');
  const threadsOn = useModEnabled('modThreads');
  const cacheTimerOn = useModEnabled('modCacheTimer');
  // «Ждут тебя» off: statuses still load while threads or the cache timer read them.
  const loadStatuses = attentionStatusesNeeded({ attention: attentionOn, threads: threadsOn, cacheTimer: cacheTimerOn });

  useEffect(() => {
    if (!loadStatuses) {
      return undefined;
    }
    void attentionStore.refresh();
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === ATTENTION_CHANGED || event.kind === 'websocket_reconnected') {
        void attentionStore.refresh();
      }
    });
    const interval = window.setInterval(() => {
      void attentionStore.refresh();
    }, ATTENTION_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void attentionStore.refresh().then(() => attentionStore.pageBecameVisible());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [subscribe, loadStatuses]);

  useEffect(() => {
    void attentionStore.setViewedSession(viewedSessionId);
  }, [viewedSessionId]);

  useEffect(() => {
    let lastShown: number | null = null;
    const publish = () => {
      // Off → «(N)» and the badge are cleared, not frozen at the last number.
      const shown = attentionCountShown(attentionStore.getSnapshot().total, attentionOn);
      if (shown === lastShown) {
        return;
      }
      lastShown = shown;
      setPageAttentionCount(shown);
      applyAppBadge(shown);
    };
    publish();
    return attentionStore.subscribe(publish);
  }, [attentionOn]);
}
