import type { TFunction } from 'i18next';

import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type { ProjectSortOrder, SettingsProject, SessionViewModel, SessionWithProvider } from '../types/types';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'name';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return settings.projectSortOrder === 'date' ? 'date' : 'name';
  } catch {
    return 'name';
  }
};

/**
 * Decides whether a session belongs in the Recent journal.
 *
 * Hiding a card is a decision about the card itself, so the entry survives any
 * later transcript activity: an idle CLI process keeps touching its JSONL file
 * (same content, newer mtime) long after the conversation is finished, and the
 * old "hidden until the transcript moves" rule un-hid everything on its own.
 * A running session is always listed, so a job that resumes by itself cannot go
 * unnoticed.
 */
export const isSessionVisibleInRecentJournal = (
  session: SessionWithProvider,
  hiddenSessions: Record<string, string>,
  activeSessionIds: ReadonlySet<string>,
): boolean => {
  const sessionId = String(session.id);

  if (activeSessionIds.has(sessionId)) {
    return true;
  }

  return !hiddenSessions[sessionId];
};

const COLLAPSED_PROJECTS_STORAGE_KEY = 'sidebar-collapsed-projects';

/**
 * Reads the project groups the user folded away in the Running/Recent views.
 * Those two views open every group by default, so what has to be remembered is
 * the opposite of `expandedProjects`: which folders were explicitly closed.
 */
export const readCollapsedProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

export const writeCollapsedProjectIds = (projectIds: string[]) => {
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify(projectIds));
  } catch {
    // Keep UI responsive even if storage is unavailable.
  }
};

const LEGACY_STARRED_PROJECTS_STORAGE_KEY = 'starredProjects';

/**
 * Reads legacy project stars from localStorage (used only for one-time migration to backend).
 */
export const readLegacyStarredProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

/**
 * Clears the legacy localStorage stars key after migration to backend completes.
 */
export const clearLegacyStarredProjectIds = () => {
  try {
    localStorage.removeItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
  } catch {
    // Keep UI responsive even if storage is unavailable.
  }
};

const getCreatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.createdAt || session.created_at || '');
};

const getUpdatedTimestamp = (session: SessionWithProvider): string => {
  return String(session.lastActivity || '');
};

const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : 'claude';
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  return new Date(getUpdatedTimestamp(session) || getCreatedTimestamp(session) || 0);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  return session.summary || session.name || t('projects.newSession');
};

export const getSessionTime = (session: SessionWithProvider): string => {
  return getUpdatedTimestamp(session) || getCreatedTimestamp(session);
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
): SessionViewModel => {
  const sessionDate = getSessionDate(session);
  const diffInMinutes = Math.floor((currentTime.getTime() - sessionDate.getTime()) / (1000 * 60));

  return {
    isActive: diffInMinutes < 10,
    sessionName: getSessionName(session, t),
    sessionTime: getSessionTime(session),
    messageCount: Number(session.messageCount || 0),
  };
};

/**
 * Creation time drives the *default* sidebar order. Sorting by last activity
 * (the old behaviour) made cards swap places every time a message landed, so
 * running several sessions at once turned the list into a slot machine.
 */
export const getSessionCreatedDate = (session: SessionWithProvider): Date => {
  return new Date(getCreatedTimestamp(session) || getUpdatedTimestamp(session) || 0);
};

export const getAllSessions = (project: Project): SessionWithProvider[] => {
  return (project.sessions || []).map((session) => ({
    ...session,
    __provider: getSessionProvider(session),
  })).sort((a, b) => {
    const byCreation = getSessionCreatedDate(b).getTime() - getSessionCreatedDate(a).getTime();
    // Identical timestamps (or none at all) must still yield a deterministic
    // order, otherwise the list can reshuffle between renders.
    return byCreation !== 0 ? byCreation : String(a.id).localeCompare(String(b.id));
  });
};

/**
 * Applies the user's drag-and-drop order on top of the creation-time default.
 *
 * `pinnedIds` holds the exact sequence the user arranged. Sessions missing from
 * it are newcomers (created after the arrangement — they belong on top, so a
 * fresh session becomes #1) or older ones that arrived via "load more" — those
 * go to the tail. `sessions` must already be sorted newest-first.
 */
export const applyManualSessionOrder = (
  sessions: SessionWithProvider[],
  pinnedIds: readonly string[] | undefined,
): SessionWithProvider[] => {
  if (!pinnedIds || pinnedIds.length === 0 || sessions.length === 0) {
    return sessions;
  }

  const rankById = new Map<string, number>();
  pinnedIds.forEach((sessionId, rank) => {
    rankById.set(sessionId, rank);
  });

  const pinned: SessionWithProvider[] = [];
  const unpinned: SessionWithProvider[] = [];
  for (const session of sessions) {
    (rankById.has(String(session.id)) ? pinned : unpinned).push(session);
  }

  if (pinned.length === 0) {
    return sessions;
  }

  pinned.sort((a, b) => (rankById.get(String(a.id)) ?? 0) - (rankById.get(String(b.id)) ?? 0));

  // Newest pinned card marks the cut-off between "created after the user
  // arranged the list" and "old session pulled in later".
  const newestPinnedTime = pinned.reduce(
    (newest, session) => Math.max(newest, getSessionCreatedDate(session).getTime()),
    0,
  );

  const newcomers = unpinned.filter((session) => getSessionCreatedDate(session).getTime() > newestPinnedTime);
  const older = unpinned.filter((session) => getSessionCreatedDate(session).getTime() <= newestPinnedTime);

  return [...newcomers, ...pinned, ...older];
};

export const getProjectLastActivity = (project: Project): Date => {
  const sessions = getAllSessions(project);
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));
};

export const sortProjects = (
  projects: Project[],
  projectSortOrder: ProjectSortOrder,
): Project[] => {
  const byName = [...projects];

  byName.sort((projectA, projectB) => {
    // Star order now comes from backend `projects.isStarred`.
    const aStarred = Boolean(projectA.isStarred);
    const bStarred = Boolean(projectB.isStarred);

    if (aStarred && !bStarred) {
      return -1;
    }

    if (!aStarred && bStarred) {
      return 1;
    }

    if (projectSortOrder === 'date') {
      return getProjectLastActivity(projectB).getTime() - getProjectLastActivity(projectA).getTime();
    }

    return (projectA.displayName || projectA.projectId).localeCompare(projectB.displayName || projectB.projectId);
  });

  return byName;
};

/**
 * Служебные каталоги, которые агент создаёт сам: временные песочницы, репро-папки
 * под баги, пробники. Проектами они не являются, но попадали в общий список и
 * висели в сайдбаре вперемешку с рабочими проектами (иногда по два раза — /tmp и
 * его же реальный путь /private/tmp).
 */
const SCRATCH_PATH_PATTERNS = [
  /^\/tmp\//,
  /^\/private\/tmp\//,
  /^\/private\/var\/folders\//,
  /^\/var\/folders\//,
  /\/\.repro-tmp\d*\//,
  /\/scratchpad(\/|$)/,
  /\/memtest\.[^/]+$/,
  /\/probe-[^/]+$/,
];

export const isScratchProject = (project: Project): boolean => {
  const projectPath = project.path || project.fullPath || '';
  if (!projectPath) {
    return false;
  }
  return SCRATCH_PATH_PATTERNS.some((pattern) => pattern.test(projectPath));
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => {
    const displayName = (project.displayName || project.projectId).toLowerCase();
    // `project.path`/`fullPath` is the most useful search target now that the
    // folder-derived name is gone; fall back to displayName above.
    const searchPath = (project.path || project.fullPath || '').toLowerCase();
    if (displayName.includes(normalizedSearch) || searchPath.includes(normalizedSearch)) {
      return true;
    }

    // Also match by words inside the project's sessions (summary/name), mirroring
    // archived-project search, so a query finds a project by its conversation
    // content and not only by its folder name.
    return getAllSessions(project).some((session) => {
      const sessionSummary =
        typeof session.summary === 'string' && session.summary.trim().length > 0
          ? session.summary
          : typeof session.name === 'string'
            ? session.name
            : '';

      return sessionSummary.toLowerCase().includes(normalizedSearch);
    });
  });
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
        ? project.path
        : '';

  // Legacy SettingsProject still expects a `name` field; use the projectId so
  // downstream consumers that rely on a stable identifier continue to work.
  return {
    name: project.projectId,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.projectId,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
