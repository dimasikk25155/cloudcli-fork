import { useCallback, useEffect, useRef, useState } from 'react';

import { QUEUED_MESSAGE_CHANGED, type QueuedMessage } from '../../../../shared/queued-message';
import { useWebSocket } from '../../../contexts/WebSocketContext';

import {
  deleteQueuedMessage,
  fetchQueuedMessage,
  putQueuedMessage,
  sendQueuedMessageNow,
  type QueuedMessageInput,
} from './queuedMessageApi';

/**
 * The chat's one queued message, kept by the SERVER. This tab only shows it and
 * edits it; the server sends it when the turn ends (tab open or not), so there is
 * no client-side auto-send. Re-read on `queued_message_changed` (any device) and
 * after a socket reconnect.
 *
 * `onConsumed` fires when the card disappears because the message went out (or
 * was cleared): the tab then re-subscribes to the chat so the run the server
 * started shows its «идёт ход» indicator.
 */
export function useServerQueuedMessage(sessionId: string | null, onConsumed?: () => void) {
  const { subscribe } = useWebSocket();
  const [queued, setQueued] = useState<QueuedMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const queuedRef = useRef<QueuedMessage | null>(null);
  const onConsumedRef = useRef(onConsumed);
  onConsumedRef.current = onConsumed;

  const apply = useCallback((forSession: string, next: QueuedMessage | null) => {
    if (sessionRef.current !== forSession) return;
    const had = queuedRef.current !== null;
    queuedRef.current = next;
    setQueued(next);
    if (had && next === null) onConsumedRef.current?.();
  }, []);

  const refresh = useCallback(async () => {
    const target = sessionRef.current;
    if (!target) return;
    try {
      apply(target, await fetchQueuedMessage(target));
    } catch {
      // Keep what is on screen; the next frame or reconnect re-reads.
    }
  }, [apply]);

  useEffect(() => {
    queuedRef.current = null;
    setQueued(null);
    if (!sessionId) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [sessionId, refresh]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected'
      || (event.kind === QUEUED_MESSAGE_CHANGED && event.sessionId === sessionRef.current)) {
      void refresh();
    }
  }), [subscribe, refresh]);

  const put = useCallback(async (input: QueuedMessageInput) => {
    const target = sessionRef.current;
    if (!target) throw new Error('No chat');
    const result = await putQueuedMessage(target, input);
    apply(target, result.queued);
    if (result.sent) onConsumedRef.current?.();
    return result;
  }, [apply]);

  const clear = useCallback(async () => {
    const target = sessionRef.current;
    if (!target) return;
    await deleteQueuedMessage(target);
    apply(target, null);
  }, [apply]);

  const sendNow = useCallback(async () => {
    const target = sessionRef.current;
    if (!target) return;
    await sendQueuedMessageNow(target);
    await refresh();
    onConsumedRef.current?.();
  }, [refresh]);

  return { queued, put, clear, sendNow, loading };
}
