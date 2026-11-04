import { useEffect, useSyncExternalStore } from 'react';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { useModEnabled } from '../../../hooks/useModEnabled';
import type { GatewayEventKind } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';

import { createGroupsStore } from './groupsStore';

const SIDEBAR_GROUPS_CHANGED: GatewayEventKind = 'sidebar_groups_changed';

export const sidebarGroupsStore = createGroupsStore(authenticatedFetch);

/**
 * Mount once in the sidebar. With the «Группы и закрепы» mod on, keeps the
 * tree in step with the account: reads it on start, after a reconnect, when
 * the tab shows again and when another device changed it.
 */
export function useSidebarGroupsSync(): void {
  const { subscribe } = useWebSocket();
  const enabled = useModEnabled('modGroups');

  useEffect(() => {
    if (!enabled) return undefined;
    void sidebarGroupsStore.refresh();
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === SIDEBAR_GROUPS_CHANGED || event.kind === 'websocket_reconnected') {
        void sidebarGroupsStore.refresh();
      }
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sidebarGroupsStore.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, subscribe]);
}

export function useSidebarGroups() {
  const enabled = useModEnabled('modGroups');
  const tree = useSyncExternalStore(sidebarGroupsStore.subscribe, sidebarGroupsStore.get, sidebarGroupsStore.get);
  return { enabled, tree };
}
