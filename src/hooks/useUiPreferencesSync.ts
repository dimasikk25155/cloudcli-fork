import { useEffect } from 'react';

import { useWebSocket } from '../contexts/WebSocketContext';
import type { ServerEvent } from '../contexts/WebSocketContext';
import type { GatewayEventKind } from '../types/app';
import { authenticatedFetch } from '../utils/api';

import { refreshUiPreferences } from './uiPreferencesStore';

const UI_PREFERENCES_CHANGED: GatewayEventKind = 'ui_preferences_changed';

const refresh = () => refreshUiPreferences(authenticatedFetch);

/**
 * Mount once at the app shell. Keeps this device's settings (mod switches
 * included) in step with the account: re-reads them when the server says they
 * were saved on another device (`ui_preferences_changed`), after a reconnect
 * (a frame may have been missed) and when the tab becomes visible again.
 */
export function useUiPreferencesSync(): void {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === UI_PREFERENCES_CHANGED || event.kind === 'websocket_reconnected') {
        void refresh();
      }
    });
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [subscribe]);
}
