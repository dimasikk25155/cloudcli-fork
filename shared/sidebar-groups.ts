/** Shape of the sidebar groups tree shared by the server and the client. */

export type SidebarItemType = 'project' | 'session';

export type SidebarGroupItem = { type: SidebarItemType; id: string };

export type SidebarGroup = {
  id: string;
  name: string;
  collapsed: boolean;
  items: SidebarGroupItem[];
};

/** Groups in display order and pinned chat ids (oldest pin first). */
export type SidebarGroupsTree = {
  groups: SidebarGroup[];
  pins: string[];
};

export const SIDEBAR_GROUP_NAME_MAX = 60;
export const SIDEBAR_GROUPS_MAX = 50;
export const SIDEBAR_GROUP_ITEMS_MAX = 500;

export function isSidebarItemType(value: unknown): value is SidebarItemType {
  return value === 'project' || value === 'session';
}
