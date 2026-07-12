import { useEffect, useRef } from 'react';

/**
 * Client-side liveness for the chat websocket.
 *
 * The server pings only at the protocol level (browsers answer invisibly to
 * JS), so a half-open socket — mobile sleep, network blip — never fires
 * `onclose`: `isConnected` stays true, frames silently stop, and the UI
 * freezes while the run keeps finishing server-side. Two recovery triggers:
 *
 * 1. Stall watchdog — while a run is processing, frames must keep arriving;
 *    prolonged silence forces a reconnect, which re-syncs through the
 *    existing `websocket_reconnected` → refetch + re-subscribe path.
 * 2. Wake handler — tab becoming visible or network coming back re-syncs the
 *    viewed session immediately instead of waiting for the stall timer.
 */

const STALL_THRESHOLD_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 5_000;
const WAKE_THROTTLE_MS = 2_000;

type ConnectionWatchdogOptions = {
  isProcessing: boolean;
  isConnected: boolean;
  getLastFrameAt: () => number;
  forceReconnect: () => void;
  /** Re-fetch history and re-subscribe the viewed session. */
  onWake: () => void;
};

export function useConnectionWatchdog({
  isProcessing,
  isConnected,
  getLastFrameAt,
  forceReconnect,
  onWake,
}: ConnectionWatchdogOptions) {
  const lastWakeAtRef = useRef(0);

  useEffect(() => {
    if (!isProcessing || !isConnected) return;

    const timer = setInterval(() => {
      const silentForMs = Date.now() - getLastFrameAt();
      if (silentForMs > STALL_THRESHOLD_MS) {
        console.warn(`[Chat] No websocket frames for ${Math.round(silentForMs / 1000)}s during an active run — forcing reconnect`);
        forceReconnect();
      }
    }, STALL_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isProcessing, isConnected, getLastFrameAt, forceReconnect]);

  useEffect(() => {
    const handleWake = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastWakeAtRef.current < WAKE_THROTTLE_MS) return;
      lastWakeAtRef.current = now;

      if (!isConnected) {
        forceReconnect();
        return;
      }
      if (isProcessing && now - getLastFrameAt() > STALL_THRESHOLD_MS) {
        // Open-looking socket that stayed silent through an active run is
        // half-open; a reconnect re-syncs, a plain refetch would leave the
        // dead socket in place.
        forceReconnect();
        return;
      }
      onWake();
    };

    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('online', handleWake);
    return () => {
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('online', handleWake);
    };
  }, [isProcessing, isConnected, getLastFrameAt, forceReconnect, onWake]);
}
