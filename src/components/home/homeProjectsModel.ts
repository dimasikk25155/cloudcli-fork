/**
 * Что и в каком порядке показывает «Домой»: сначала закреплённые, затем
 * недавние (чат за 14 дней, не больше 12), всё — от свежего к старому.
 * Мусорные папки (Codex/ChatGPT, tmp, служебные) на «Домой» не попадают,
 * если Дима сам их не закрепил. Без React — чистые функции под тест.
 */
import type { Project } from '../../types/app';
import { getSessionDate, isCodexInboxProject, isScratchProject } from '../sidebar/utils/utils';

export const HOME_RECENT_LIMIT = 12;
export const HOME_RECENT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type HomeProjectsOptions = {
  now: number;
  query: string;
  showAll: boolean;
};

export type HomeProjects = {
  items: Project[];
  /** Non-junk, unpinned projects the collapsed view leaves out (0 when showing all or searching). */
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

export function buildHomeProjects(projects: Project[], { now, query, showAll }: HomeProjectsOptions): HomeProjects {
  const pinned = byRecency(projects.filter((project) => project.isStarred));
  const rest = byRecency(projects.filter((project) => !project.isStarred && !isHomeJunkProject(project)));

  const needle = query.trim().toLowerCase();
  if (needle) {
    const matches = (project: Project) =>
      (project.displayName || '').toLowerCase().includes(needle)
      || (project.fullPath || '').toLowerCase().includes(needle);
    return { items: [...pinned.filter(matches), ...rest.filter(matches)], hiddenCount: 0 };
  }

  if (showAll) {
    return { items: [...pinned, ...rest], hiddenCount: 0 };
  }

  const since = now - HOME_RECENT_MAX_AGE_MS;
  const recent = rest
    .filter((project) => projectRecency(project) >= since)
    .slice(0, HOME_RECENT_LIMIT);
  return { items: [...pinned, ...recent], hiddenCount: rest.length - recent.length };
}
