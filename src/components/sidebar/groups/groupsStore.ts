import type { SidebarGroupsTree, SidebarItemType } from '../../../../shared/sidebar-groups';

import { EMPTY_GROUPS_TREE } from './groupsModel';

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const BASE = '/api/sidebar-groups';

/**
 * The user's groups tree as the server holds it. Every action sends the
 * change and takes the answer (the whole tree) as the new state; the server
 * also sends `sidebar_groups_changed` to the user's other devices.
 */
export function createGroupsStore(fetcher: FetchLike) {
  let tree: SidebarGroupsTree = EMPTY_GROUPS_TREE;
  const listeners = new Set<() => void>();
  const set = (next: SidebarGroupsTree) => {
    tree = next;
    listeners.forEach((listener) => listener());
  };

  async function call(method: string, path = '', body?: unknown): Promise<void> {
    try {
      const response = await fetcher(`${BASE}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) return; // MOD_OFF or a refusal: keep what is shown
      const payload = await response.json() as { data?: SidebarGroupsTree };
      if (payload?.data && Array.isArray(payload.data.groups)) set({ groups: payload.data.groups, pins: payload.data.pins ?? [] });
    } catch {
      // Offline: the next frame or refresh brings the tree back.
    }
  }

  const id = encodeURIComponent;
  return {
    get: () => tree,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => call('GET'),
    create: (name: string) => call('POST', '', { name }),
    rename: (groupId: string, name: string) => call('PATCH', `/${id(groupId)}`, { name }),
    setCollapsed: (groupId: string, collapsed: boolean) => call('PATCH', `/${id(groupId)}`, { collapsed }),
    reorder: (ids: string[]) => call('PUT', '/order', { ids }),
    remove: (groupId: string) => call('DELETE', `/${id(groupId)}`),
    /** Replaces one group's members: used to add (append) or take out an item. */
    setItems: (groupId: string, items: Array<{ type: SidebarItemType; id: string }>) => call('PUT', `/${id(groupId)}/items`, { items }),
    pin: (sessionId: string) => call('PUT', `/pins/${id(sessionId)}`),
    unpin: (sessionId: string) => call('DELETE', `/pins/${id(sessionId)}`),
  };
}
