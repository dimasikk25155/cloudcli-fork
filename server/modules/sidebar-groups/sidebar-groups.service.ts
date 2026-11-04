import { randomUUID } from 'node:crypto';

import { isModOn as defaultIsModOn, modOffError, type IsModOn } from '@/shared/mods.js';
import { AppError } from '@/shared/utils.js';

import {
  SIDEBAR_GROUPS_MAX,
  SIDEBAR_GROUP_ITEMS_MAX,
  SIDEBAR_GROUP_NAME_MAX,
  isSidebarItemType,
  type SidebarGroup,
  type SidebarGroupItem,
  type SidebarGroupsTree,
  type SidebarItemType,
} from '../../../shared/sidebar-groups.js';

/** The slice of the repository the service uses (a seam for tests). */
export type SidebarGroupsRepo = {
  listGroups(userId: number): Array<{ id: string; name: string; collapsed: number }>;
  getGroup(id: string): { id: string; user_id: number } | undefined;
  listItems(userId: number): Array<{ group_id: string; item_type: SidebarItemType; item_id: string }>;
  createGroup(userId: number, id: string, name: string, createdAt: string): unknown;
  renameGroup(id: string, name: string): void;
  setCollapsed(id: string, collapsed: boolean): void;
  reorderGroups(userId: number, orderedIds: string[]): void;
  deleteGroup(id: string): void;
  addItem(userId: number, groupId: string, type: SidebarItemType, itemId: string): void;
  removeItem(groupId: string, type: SidebarItemType, itemId: string): void;
  setItems(userId: number, groupId: string, items: Array<{ type: SidebarItemType; id: string }>): void;
  listPins(userId: number): Array<{ session_id: string }>;
  setPin(userId: number, sessionId: string, pinnedAt: string): void;
  removePin(userId: number, sessionId: string): void;
};

export type SidebarGroupsDependencies = {
  repo: SidebarGroupsRepo;
  canAccessProject(userId: number, projectId: string): boolean;
  canAccessSession(userId: number, sessionId: string): boolean;
  /** Content-free "re-read the tree" frame for the user's sockets. */
  notify?(userId: number): void;
  isModOn?: IsModOn;
  now?: () => string;
  newId?: () => string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Groups of projects/chats and chat pins. Pure ordering: no access is granted
 * or taken, no file is touched. Every call re-checks the «Группы» switch, the
 * owner of the group and the user's access to the added project/chat.
 * Groups are deleted by the human only (`remove`); the agent never gets it.
 */
export function createSidebarGroupsService(deps: SidebarGroupsDependencies) {
  const { repo } = deps;
  const isModOn = deps.isModOn ?? defaultIsModOn;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());

  const gate = (userId: number) => {
    if (!isModOn(userId, 'modGroups')) throw modOffError('modGroups');
  };
  const changed = (userId: number) => {
    try {
      deps.notify?.(userId);
    } catch {
      // A failed frame must not undo a saved change.
    }
  };
  const ownGroup = (userId: number, id: unknown): string => {
    const groupId = text(id);
    const group = groupId ? repo.getGroup(groupId) : undefined;
    // Someone else's group looks exactly like a missing one.
    if (!group || group.user_id !== userId) throw new AppError('Группа не найдена', { code: 'GROUP_NOT_FOUND', statusCode: 404 });
    return group.id;
  };
  const itemOf = (type: unknown, id: unknown): SidebarGroupItem => {
    const itemId = text(id);
    if (!isSidebarItemType(type) || !itemId) throw new AppError('Нужны тип (проект или чат) и id', { code: 'GROUP_ITEM_INVALID', statusCode: 400 });
    return { type, id: itemId };
  };
  const checkAccess = (userId: number, item: SidebarGroupItem) => {
    const allowed = item.type === 'project' ? deps.canAccessProject(userId, item.id) : deps.canAccessSession(userId, item.id);
    if (!allowed) throw new AppError('Нет доступа к этому проекту или чату', { code: 'GROUP_ITEM_FORBIDDEN', statusCode: 403 });
  };
  const nameOf = (value: unknown): string => {
    const name = text(value);
    if (!name) throw new AppError('Назовите группу', { code: 'GROUP_NAME_REQUIRED', statusCode: 400 });
    if (name.length > SIDEBAR_GROUP_NAME_MAX) throw new AppError(`Название не длиннее ${SIDEBAR_GROUP_NAME_MAX} знаков`, { code: 'GROUP_NAME_TOO_LONG', statusCode: 400 });
    return name;
  };

  const tree = (userId: number): SidebarGroupsTree => {
    const items = repo.listItems(userId);
    const groups: SidebarGroup[] = repo.listGroups(userId).map((group) => ({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed === 1,
      // Access may have been revoked after the item was added: it just disappears from the view.
      items: items
        .filter((item) => item.group_id === group.id)
        .map((item): SidebarGroupItem => ({ type: item.item_type, id: item.item_id }))
        .filter((item) => (item.type === 'project' ? deps.canAccessProject(userId, item.id) : deps.canAccessSession(userId, item.id))),
    }));
    const pins = repo.listPins(userId).map((pin) => pin.session_id).filter((id) => deps.canAccessSession(userId, id));
    return { groups, pins };
  };

  return {
    list(userId: number): SidebarGroupsTree {
      gate(userId);
      return tree(userId);
    },

    create(userId: number, input: { name?: unknown }): SidebarGroupsTree {
      gate(userId);
      const name = nameOf(input.name);
      if (repo.listGroups(userId).length >= SIDEBAR_GROUPS_MAX) throw new AppError('Слишком много групп', { code: 'GROUP_LIMIT', statusCode: 400 });
      repo.createGroup(userId, newId(), name, now());
      changed(userId);
      return tree(userId);
    },

    update(userId: number, groupId: unknown, input: { name?: unknown; collapsed?: unknown }): SidebarGroupsTree {
      gate(userId);
      const id = ownGroup(userId, groupId);
      if (input.name !== undefined) repo.renameGroup(id, nameOf(input.name));
      if (typeof input.collapsed === 'boolean') repo.setCollapsed(id, input.collapsed);
      changed(userId);
      return tree(userId);
    },

    reorder(userId: number, orderedIds: unknown): SidebarGroupsTree {
      gate(userId);
      if (!Array.isArray(orderedIds)) throw new AppError('Нужен список групп', { code: 'GROUP_ORDER_INVALID', statusCode: 400 });
      repo.reorderGroups(userId, orderedIds.filter((id): id is string => typeof id === 'string'));
      changed(userId);
      return tree(userId);
    },

    /** Human only: the agent surface has no such action. Chats and projects stay where they are. */
    remove(userId: number, groupId: unknown): SidebarGroupsTree {
      gate(userId);
      repo.deleteGroup(ownGroup(userId, groupId));
      changed(userId);
      return tree(userId);
    },

    addItem(userId: number, groupId: unknown, type: unknown, itemId: unknown): SidebarGroupsTree {
      gate(userId);
      const id = ownGroup(userId, groupId);
      const item = itemOf(type, itemId);
      checkAccess(userId, item);
      repo.addItem(userId, id, item.type, item.id);
      changed(userId);
      return tree(userId);
    },

    removeItem(userId: number, groupId: unknown, type: unknown, itemId: unknown): SidebarGroupsTree {
      gate(userId);
      const id = ownGroup(userId, groupId);
      const item = itemOf(type, itemId);
      repo.removeItem(id, item.type, item.id);
      changed(userId);
      return tree(userId);
    },

    setItems(userId: number, groupId: unknown, items: unknown): SidebarGroupsTree {
      gate(userId);
      const id = ownGroup(userId, groupId);
      if (!Array.isArray(items) || items.length > SIDEBAR_GROUP_ITEMS_MAX) throw new AppError('Некорректный список', { code: 'GROUP_ITEMS_INVALID', statusCode: 400 });
      const parsed = items.map((raw) => {
        const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const item = itemOf(row.type, row.id);
        checkAccess(userId, item);
        return item;
      });
      repo.setItems(userId, id, parsed);
      changed(userId);
      return tree(userId);
    },

    setPin(userId: number, sessionId: unknown, pinned: unknown): SidebarGroupsTree {
      gate(userId);
      const id = text(sessionId);
      if (!id) throw new AppError('Нужен чат', { code: 'PIN_SESSION_REQUIRED', statusCode: 400 });
      if (pinned === false) {
        repo.removePin(userId, id);
      } else {
        if (!deps.canAccessSession(userId, id)) throw new AppError('Нет доступа к этому чату', { code: 'GROUP_ITEM_FORBIDDEN', statusCode: 403 });
        repo.setPin(userId, id, now());
      }
      changed(userId);
      return tree(userId);
    },
  };
}

export type SidebarGroupsService = ReturnType<typeof createSidebarGroupsService>;
