import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { GatewayEventKind } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';

import {
  createAutoRelayStatusStore,
  createMoveFollower,
  readAutoRelayStatus,
  type AutoRelayStatus,
  type MoveFollower,
} from './autoRelayModel';

const AUTO_RELAY_FRAME: GatewayEventKind = 'auto_relay';

// Shared by every subscriber of the page; «what was before» is per subscriber.
const statuses = createAutoRelayStatusStore();

async function fetchStatus(sessionId: string): Promise<AutoRelayStatus | null> {
  const response = await authenticatedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-relay`);
  if (!response.ok) return null;
  return readAutoRelayStatus(await response.json());
}

async function putEnabled(sessionId: string, enabled: boolean): Promise<AutoRelayStatus | null> {
  const response = await authenticatedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-relay`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`Авто-перенос не переключить (${response.status})`);
  }
  return readAutoRelayStatus(await response.json());
}

async function postStart(sessionId: string): Promise<AutoRelayStatus | null> {
  const response = await authenticatedFetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-relay/start`, {
    method: 'POST',
  });
  if (!response.ok) {
    let message = `Перенос не начать (${response.status})`;
    try {
      const body = await response.json() as { error?: { message?: unknown } | string; message?: unknown };
      const text = typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message;
      if (typeof text === 'string' && text.trim()) message = text;
    } catch {
      // Not JSON: the status code says enough.
    }
    throw new Error(message);
  }
  return readAutoRelayStatus(await response.json());
}

export type AutoRelayControl = {
  /** Server status of the open chat; null until loaded / no chat. */
  status: AutoRelayStatus | null;
  setEnabled: (enabled: boolean) => void;
  /** «Перенести»: the server moves the open chat now; rejects with the reason. */
  startNow: () => Promise<void>;
};

/**
 * «Авто-перенос» of the open chat: loads the server status, follows the
 * `auto_relay` frames, flips the switch, starts a move by «Перенести», and —
 * when the open chat finishes moving while this tab watches — calls
 * `onMoved(childId)` to follow it.
 */
export function useAutoRelay(sessionId: string | null, onMoved: (childSessionId: string) => void): AutoRelayControl {
  const { subscribe } = useWebSocket();
  const status = useSyncExternalStore(
    statuses.subscribe,
    () => (sessionId ? statuses.get(sessionId) ?? null : null),
    () => null,
  );
  const followerRef = useRef<MoveFollower | null>(null);
  if (!followerRef.current) followerRef.current = createMoveFollower(statuses);
  const follower = followerRef.current;

  const openRef = useRef(sessionId);
  openRef.current = sessionId;
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

  const refresh = useCallback((id: string) => {
    void fetchStatus(id)
      .then((next) => {
        if (next) follower.note(next);
      })
      .catch((error: unknown) => {
        console.warn('[AutoRelay] status not loaded', error);
      });
  }, [follower]);

  useEffect(() => {
    if (sessionId) refresh(sessionId);
  }, [sessionId, refresh]);

  useEffect(() => subscribe((event: ServerEvent) => {
    if (event.kind === 'websocket_reconnected') {
      if (openRef.current) refresh(openRef.current);
      return;
    }
    if (event.kind !== AUTO_RELAY_FRAME) return;
    const next = readAutoRelayStatus(event.status);
    if (!next) return;
    const childId = follower.frame(next, openRef.current);
    if (childId) onMovedRef.current(childId);
  }), [subscribe, refresh, follower]);

  const setEnabled = useCallback((enabled: boolean) => {
    if (!sessionId) return;
    const current = statuses.get(sessionId);
    if (current) {
      follower.note({ ...current, enabled, ...(current.state === 'failed' ? { state: null, error: null } : {}) });
    }
    void putEnabled(sessionId, enabled)
      .then((next) => {
        if (next) follower.note(next);
      })
      .catch((error: unknown) => {
        console.warn('[AutoRelay] switch failed', error);
        refresh(sessionId);
      });
  }, [sessionId, refresh, follower]);

  const startNow = useCallback(async () => {
    if (!sessionId) return;
    const next = await postStart(sessionId);
    if (next) follower.note(next);
  }, [sessionId, follower]);

  return { status, setEnabled, startNow };
}
