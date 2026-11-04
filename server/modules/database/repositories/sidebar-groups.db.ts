/**
 * Sidebar groups and chat pins. Pure ordering data: a group never grants or
 * removes access, and deleting a group never deletes the projects or chats in it.
 */

import { getConnection } from '@/modules/database/connection.js';

export type SidebarItemType = 'project' | 'session';

export type SidebarGroupRow = {
  id: string;
  user_id: number;
  name: string;
  position: number;
  collapsed: number;
  created_at: string;
};

export type SidebarGroupItemRow = {
  group_id: string;
  item_type: SidebarItemType;
  item_id: string;
  position: number;
};

export type SessionPinRow = { session_id: string; pinned_at: string };

export const sidebarGroupsDb = {
  listGroups(userId: number): SidebarGroupRow[] {
    return getConnection()
      .prepare('SELECT * FROM sidebar_groups WHERE user_id = ? ORDER BY position, created_at, id')
      .all(userId) as SidebarGroupRow[];
  },

  getGroup(id: string): SidebarGroupRow | undefined {
    return getConnection().prepare('SELECT * FROM sidebar_groups WHERE id = ?').get(id) as SidebarGroupRow | undefined;
  },

  listItems(userId: number): SidebarGroupItemRow[] {
    return getConnection()
      .prepare(
        `SELECT i.* FROM sidebar_group_items i
         JOIN sidebar_groups g ON g.id = i.group_id
         WHERE g.user_id = ? ORDER BY i.group_id, i.position, i.item_id`
      )
      .all(userId) as SidebarGroupItemRow[];
  },

  createGroup(userId: number, id: string, name: string, createdAt: string): SidebarGroupRow {
    const db = getConnection();
    const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sidebar_groups WHERE user_id = ?').get(userId) as { n: number };
    db.prepare('INSERT INTO sidebar_groups (id, user_id, name, position, collapsed, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(id, userId, name, next.n, createdAt);
    return sidebarGroupsDb.getGroup(id)!;
  },

  renameGroup(id: string, name: string): void {
    getConnection().prepare('UPDATE sidebar_groups SET name = ? WHERE id = ?').run(name, id);
  },

  setCollapsed(id: string, collapsed: boolean): void {
    getConnection().prepare('UPDATE sidebar_groups SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
  },

  /** Positions follow the given order; ids the user does not own are ignored. */
  reorderGroups(userId: number, orderedIds: string[]): void {
    const db = getConnection();
    const update = db.prepare('UPDATE sidebar_groups SET position = ? WHERE id = ? AND user_id = ?');
    db.transaction(() => {
      orderedIds.forEach((id, index) => update.run(index, id, userId));
    })();
  },

  /** Human-only: removes the group and its membership rows, nothing else. */
  deleteGroup(id: string): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare('DELETE FROM sidebar_group_items WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM sidebar_groups WHERE id = ?').run(id);
    })();
  },

  /** An item sits in at most one group of a user: adding moves it. */
  addItem(userId: number, groupId: string, type: SidebarItemType, itemId: string): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare(
        `DELETE FROM sidebar_group_items WHERE item_type = ? AND item_id = ?
         AND group_id IN (SELECT id FROM sidebar_groups WHERE user_id = ?)`
      ).run(type, itemId, userId);
      const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sidebar_group_items WHERE group_id = ?').get(groupId) as { n: number };
      db.prepare('INSERT INTO sidebar_group_items (group_id, item_type, item_id, position) VALUES (?, ?, ?, ?)')
        .run(groupId, type, itemId, next.n);
    })();
  },

  removeItem(groupId: string, type: SidebarItemType, itemId: string): void {
    getConnection()
      .prepare('DELETE FROM sidebar_group_items WHERE group_id = ? AND item_type = ? AND item_id = ?')
      .run(groupId, type, itemId);
  },

  /** Replaces the whole membership of a group (the order is the array order). */
  setItems(userId: number, groupId: string, items: Array<{ type: SidebarItemType; id: string }>): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare('DELETE FROM sidebar_group_items WHERE group_id = ?').run(groupId);
      const drop = db.prepare(
        `DELETE FROM sidebar_group_items WHERE item_type = ? AND item_id = ?
         AND group_id IN (SELECT id FROM sidebar_groups WHERE user_id = ?)`
      );
      const insert = db.prepare('INSERT INTO sidebar_group_items (group_id, item_type, item_id, position) VALUES (?, ?, ?, ?)');
      items.forEach((item, index) => {
        drop.run(item.type, item.id, userId);
        insert.run(groupId, item.type, item.id, index);
      });
    })();
  },

  listPins(userId: number): SessionPinRow[] {
    return getConnection()
      .prepare('SELECT session_id, pinned_at FROM session_pins WHERE user_id = ? ORDER BY pinned_at, session_id')
      .all(userId) as SessionPinRow[];
  },

  setPin(userId: number, sessionId: string, pinnedAt: string): void {
    getConnection()
      .prepare('INSERT OR IGNORE INTO session_pins (user_id, session_id, pinned_at) VALUES (?, ?, ?)')
      .run(userId, sessionId, pinnedAt);
  },

  removePin(userId: number, sessionId: string): void {
    getConnection().prepare('DELETE FROM session_pins WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
  },
};
