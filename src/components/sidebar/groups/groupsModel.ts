/**
 * Pure arrangement of the sidebar: which projects sit in which group, and
 * pinned chats first. No fetching here — see `groupsStore.ts`.
 */
import type { SidebarGroup, SidebarGroupsTree } from '../../../../shared/sidebar-groups';

export const EMPTY_GROUPS_TREE: SidebarGroupsTree = { groups: [], pins: [] };

export type ProjectSection<P> = {
  /** null — projects outside any group. */
  group: SidebarGroup | null;
  projects: P[];
};

/**
 * Sections in display order: every group (also empty ones, so they can be
 * filled), then the rest. A project listed in a group but absent from
 * `projects` (filtered out, archived, no access) is skipped.
 */
export function arrangeProjects<P extends { projectId: string }>(projects: P[], tree: SidebarGroupsTree): ProjectSection<P>[] {
  const byId = new Map(projects.map((project) => [project.projectId, project]));
  const placed = new Set<string>();
  const sections: ProjectSection<P>[] = tree.groups.map((group) => {
    const members: P[] = [];
    for (const item of group.items) {
      const project = item.type === 'project' ? byId.get(item.id) : undefined;
      if (project && !placed.has(project.projectId)) {
        placed.add(project.projectId);
        members.push(project);
      }
    }
    return { group, projects: members };
  });
  const rest = projects.filter((project) => !placed.has(project.projectId));
  return [...sections, { group: null, projects: rest }];
}

/** Id of the group holding a project, if any. */
export function groupOfProject(tree: SidebarGroupsTree, projectId: string): string | null {
  return tree.groups.find((group) => group.items.some((item) => item.type === 'project' && item.id === projectId))?.id ?? null;
}

/** Pinned chats go up (in pin order), the rest keep their order. Nothing is lost or duplicated. */
export function pinnedFirst<S extends { id: string | number }>(sessions: S[], pins: readonly string[]): S[] {
  if (pins.length === 0) return sessions;
  const pinned = new Map(sessions.filter((session) => pins.includes(String(session.id))).map((session) => [String(session.id), session]));
  if (pinned.size === 0) return sessions;
  const head = pins.map((id) => pinned.get(id)).filter((session): session is S => Boolean(session));
  return [...head, ...sessions.filter((session) => !pinned.has(String(session.id)))];
}

/** New order of group ids after moving one group a step up (-1) or down (+1). */
export function moveGroup(tree: SidebarGroupsTree, groupId: string, step: -1 | 1): string[] {
  const ids = tree.groups.map((group) => group.id);
  const from = ids.indexOf(groupId);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}
