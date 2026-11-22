/**
 * Что и в каком порядке показывает «Домой» и папка «Все проекты».
 * «Домой» — ровно по экрану: сначала все закреплённые, затем проекты с чатами
 * от свежего к старому, последняя ячейка сетки — плитка «Все проекты».
 * Папка — все проекты: закреплённые, с чатами по недавности, без чатов по имени.
 * Мусорные папки (Codex/ChatGPT, tmp, служебные) не попадают никуда,
 * если Дима сам их не закрепил. Без React — чистые функции под тест.
 */
import type { Project } from '../../types/app';
import { getSessionDate, isCodexInboxProject, isScratchProject } from '../sidebar/utils/utils';

export type HomeProjectsOptions = {
  query: string;
  /** Cells the Home grid holds on this screen; the last one is the «All projects» tile. */
  capacity: number;
};

export type HomeProjects = {
  items: Project[];
  /** Projects of the «All projects» folder that Home does not show (0 while searching). */
  hiddenCount: number;
};

const TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/folders', '/private/var'];
const WORK_SEGMENTS = new Set(['tmp', 'outputs']);

const projectPath = (project: Project): string =>
  (project.path || project.fullPath || '').replace(/\\/g, '/');

export function isHomeJunkProject(project: Project): boolean {
  if (isScratchProject(project) || isCodexInboxProject(project)) {
    return true;
  }

  const path = projectPath(project);
  if (!path) {
    return false;
  }
  if (TEMP_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))) {
    return true;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.') || WORK_SEGMENTS.has(segment))) {
    return true;
  }
  return (segments[segments.length - 1] ?? '').endsWith('-repro');
}

/** Newest chat activity of the project, ms; 0 when it has no chats. */
export function projectRecency(project: Project): number {
  let newest = 0;
  for (const session of project.sessions ?? []) {
    const time = getSessionDate(session as Parameters<typeof getSessionDate>[0]).getTime();
    if (Number.isFinite(time) && time > newest) {
      newest = time;
    }
  }
  return newest;
}

function byRecency(projects: Project[]): Project[] {
  const recency = new Map(projects.map((project) => [project, projectRecency(project)]));
  return [...projects].sort((left, right) => {
    const diff = (recency.get(right) ?? 0) - (recency.get(left) ?? 0);
    if (diff !== 0) return diff;
    return (left.displayName || '').localeCompare(right.displayName || '', 'ru');
  });
}

/** Case-insensitive match of the name or the full path; an empty query matches everything. */
export function matchesProjectQuery(project: Project, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (project.displayName || '').toLowerCase().includes(needle)
    || (project.fullPath || '').toLowerCase().includes(needle);
}

/**
 * The «All projects» folder: pinned (even junk ones) by recency, then the rest
 * without junk — with chats by recency, then without chats by name.
 */
export function buildAllProjects(projects: Project[]): Project[] {
  const pinned = byRecency(projects.filter((project) => project.isStarred));
  const rest = byRecency(projects.filter((project) => !project.isStarred && !isHomeJunkProject(project)));
  return [...pinned, ...rest];
}

export function buildHomeProjects(projects: Project[], { query, capacity }: HomeProjectsOptions): HomeProjects {
  const all = buildAllProjects(projects);

  if (query.trim()) {
    return { items: all.filter((project) => matchesProjectQuery(project, query)), hiddenCount: 0 };
  }

  // All pinned, then projects with chats; no chats — only in the folder.
  const candidates = all.filter((project) => project.isStarred || projectRecency(project) > 0);
  const slots = Math.max(0, Math.floor(capacity) - 1);
  const items = candidates.slice(0, slots);
  return { items, hiddenCount: all.length - items.length };
}
