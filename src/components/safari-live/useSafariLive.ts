import { useCallback, useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { SafariLiveView } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';

export type UseSafariLive = {
  view: SafariLiveView | null;
  /** Запрос не удался (сеть, права) — вкладка покажет «Связь прервалась». */
  failed: boolean;
  select: (windowId: number) => Promise<void>;
  retry: () => Promise<void>;
};

/** Ответ сервера лежит в `data` (createApiSuccessResponse); допускаем и «голый» вид. */
function unwrapView(payload: unknown): SafariLiveView | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { data?: unknown; state?: unknown };
  const candidate = (record.data && typeof record.data === 'object' ? record.data : record) as Partial<SafariLiveView>;
  return typeof candidate.state === 'string' ? (candidate as SafariLiveView) : null;
}

async function request(sessionId: string, init?: RequestInit): Promise<SafariLiveView | null> {
  const response = await authenticatedFetch(`/api/safari-live/sessions/${encodeURIComponent(sessionId)}`, init);
  if (!response.ok) return null;
  return unwrapView(await response.json().catch(() => null));
}

/** Привязка чата к окну Safari; перечитывается по кадру `safari_live_changed` и после переподключения. */
export function useSafariLive(sessionId: string | null): UseSafariLive {
  const { subscribe } = useWebSocket();
  const [view, setView] = useState<SafariLiveView | null>(null);
  const [failed, setFailed] = useState(false);
  const currentRef = useRef<string | null>(sessionId);
  currentRef.current = sessionId;

  const load = useCallback(async () => {
    if (!sessionId) {
      setView(null);
      return;
    }
    try {
      const next = await request(sessionId);
      if (currentRef.current !== sessionId) return;
      setFailed(next === null);
      if (next) setView(next);
    } catch {
      if (currentRef.current === sessionId) setFailed(true);
    }
  }, [sessionId]);

  useEffect(() => {
    setView(null);
    setFailed(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribe((event: ServerEvent) => {
      if (event.kind === 'websocket_reconnected' || (event.kind === 'safari_live_changed' && event.sessionId === sessionId)) {
        void load();
      }
    });
  }, [sessionId, subscribe, load]);

  const select = useCallback(
    async (windowId: number) => {
      if (!sessionId) return;
      try {
        const next = await request(sessionId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windowId }),
        });
        if (currentRef.current !== sessionId) return;
        if (next) {
          setView(next);
          setFailed(false);
        } else {
          // Окно успело исчезнуть — свежий список честнее старого.
          await load();
        }
      } catch {
        if (currentRef.current === sessionId) setFailed(true);
      }
    },
    [sessionId, load],
  );

  return { view, failed, select, retry: load };
}
