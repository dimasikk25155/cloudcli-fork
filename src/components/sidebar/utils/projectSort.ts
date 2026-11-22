/**
 * Order of the sidebar «Проекты» list. Kept apart from `utils.ts` because the
 * recency key comes from the «Домой» model, which itself imports `utils.ts`.
 */
import type { Project } from '../../../types/app';
import { projectRecency } from '../../home/homeProjectsModel';
import type { ProjectSortOrder } from '../types/types';

import { isCodexInboxProject } from './utils';

const projectName = (project: Project): string => project.displayName || project.projectId;

const byName = (left: Project, right: Project): number =>
  projectName(left).localeCompare(projectName(right), 'ru') || left.projectId.localeCompare(right.projectId);

/**
 * Pinned first (a pin also lifts a Codex/ChatGPT folder); unpinned
 * Codex/ChatGPT folders below real workspaces; then `'recent'` — newest chat
 * activity first (`projectRecency`), ties and chat-less projects by name —
 * or `'name'` — by name (Russian collation).
 */
export const sortProjects = (projects: Project[], order: ProjectSortOrder): Project[] => {
  const recency = order === 'recent'
    ? new Map(projects.map((project) => [project, projectRecency(project)]))
    : null;

  return [...projects].sort((left, right) => {
    const leftStarred = Boolean(left.isStarred);
    const rightStarred = Boolean(right.isStarred);
    if (leftStarred !== rightStarred) {
      return leftStarred ? -1 : 1;
    }

    const leftInbox = isCodexInboxProject(left);
    const rightInbox = isCodexInboxProject(right);
    if (leftInbox !== rightInbox) {
      return leftInbox ? 1 : -1;
    }

    if (recency) {
      const diff = (recency.get(right) ?? 0) - (recency.get(left) ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }

    return byName(left, right);
  });
};
