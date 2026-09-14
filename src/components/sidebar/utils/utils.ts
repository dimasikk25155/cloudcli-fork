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
 * Hiding a card is a decision about the card itself. An idle CLI process keeps
 * touching its JSONL file (same content, newer mtime) and can sit in the
 * "running" set for hours after the conversation is finished, so neither
 * "newer than the hide timestamp" nor "currently running" may bring a hidden
 * card back. It returns only when the user opens that session again.
 */
export const isSessionVisibleInRecentJournal = (
  session: SessionWithProvider,
  hiddenSessions: Record<string, string>,
): boolean => !hiddenSessions[String(session.id)];

const EXPANDED_JOURNAL_PROJECTS_STORAGE_KEY = 'sidebar-expanded-journal-projects';

/**
 * Reads which project folders the user opened in the Running/Recent views.
 * Those views keep every group folded until a click, so what has to be
 * remembered is the opposite of the old "all open, remember the closed ones".
 */
export const readExpandedJournalProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(EXPANDED_JOURNAL_PROJECTS_STORAGE_KEY);
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

export const writeExpandedJournalProjectIds = (projectIds: string[]) => {
  try {
    localStorage.setItem(EXPANDED_JOURNAL_PROJECTS_STORAGE_KEY, JSON.stringify(projectIds));
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
 *
 * Never fall back to `lastActivity` here: the API used to omit `createdAt`
 * and this helper then sorted by a timestamp that ticks on every token.
 */
export const getSessionCreatedDate = (session: SessionWithProvider): Date => {
  const created = getCreatedTimestamp(session);
  if (!created) {
    return new Date(0);
  }

  const date = new Date(created);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
};

const readCreatedTimestamp = (session: ProjectSession | undefined): string => {
  if (!session) {
    return '';
  }

  const value = session.createdAt || session.created_at;
  return typeof value === 'string' && value.trim() ? value : '';
};

/**
 * Pins a session's creation time so later activity ticks cannot reshuffle it.
 *
 * Server payloads historically sent only `lastActivity`. The first value we
 * see is frozen as `createdAt`; later upserts may refresh `lastActivity` for
 * the "9m ago" label but must not rewrite the sort key. A real `createdAt`
 * from the server always wins.
 */
export const preserveSessionCreatedAt = (
  incoming: ProjectSession,
  previous?: ProjectSession,
): ProjectSession => {
  const fromIncoming = readCreatedTimestamp(incoming);
  if (fromIncoming) {
    return { ...incoming, createdAt: fromIncoming, created_at: fromIncoming };
  }

  const fromPrevious = readCreatedTimestamp(previous);
  if (fromPrevious) {
    return { ...incoming, createdAt: fromPrevious, created_at: fromPrevious };
  }

  const fallback =
    (typeof incoming.lastActivity === 'string' && incoming.lastActivity.trim())
      ? incoming.lastActivity
      : new Date().toISOString();

  return { ...incoming, createdAt: fallback, created_at: fallback };
};

export const preserveProjectSessionsCreatedAt = (
  incoming: Project,
  previous?: Project,
): Project => {
  const previousById = new Map(
    (previous?.sessions ?? []).map((session) => [String(session.id), session]),
  );

  return {
    ...incoming,
    sessions: (incoming.sessions ?? []).map((session) =>
      preserveSessionCreatedAt(session, previousById.get(String(session.id))),
    ),
  };
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

export const getProjectNewestCreated = (project: Project): Date => {
  const sessions = project.sessions ?? [];
  if (sessions.length === 0) {
    return new Date(0);
  }

  return sessions.reduce((latest, session) => {
    const created = getSessionCreatedDate(session as SessionWithProvider);
    return created > latest ? created : latest;
  }, new Date(0));
};

/**
 * Sort key for project folders. Used to be max(`lastActivity`), which ticks
 * on every streamed token and swapped two busy folders with each other.
 */
export const getProjectLastActivity = (project: Project): Date => getProjectNewestCreated(project);

const compareProjectsByNewestCreated = (projectA: Project, projectB: Project): number => {
  const byCreated = getProjectNewestCreated(projectB).getTime() - getProjectNewestCreated(projectA).getTime();
  if (byCreated !== 0) {
    return byCreated;
  }

  const byName = (projectA.displayName || projectA.projectId).localeCompare(
    projectB.displayName || projectB.projectId,
  );
  if (byName !== 0) {
    return byName;
  }

  return projectA.projectId.localeCompare(projectB.projectId);
};

const getProjectPath = (project: Project): string => project.path || project.fullPath || '';

/**
 * Codex desktop / ChatGPT desktop drop each thread into
 * `~/Documents/Codex/...` or `~/Documents/ChatGPT/...`. Those folders are
 * real session homes, but they are not the agency's project list — they
 * used to sit alphabetically between Tyres and generate and bury the
 * actual workspaces.
 */
export const isCodexInboxProject = (project: Project): boolean => {
  const projectPath = getProjectPath(project);
  if (!projectPath) {
    return false;
  }

  return /\/Documents\/Codex\//.test(projectPath) || /\/Documents\/ChatGPT\//.test(projectPath);
};

export const partitionCodexInboxProjects = (
  projects: Project[],
): { workspaceProjects: Project[]; codexInboxProjects: Project[] } => {
  const workspaceProjects: Project[] = [];
  const codexInboxProjects: Project[] = [];

  for (const project of projects) {
    if (isCodexInboxProject(project)) {
      codexInboxProjects.push(project);
    } else {
      workspaceProjects.push(project);
    }
  }

  return { workspaceProjects, codexInboxProjects };
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

    // Unstarred Codex inbox folders stay below real workspaces. Starring one
    // still lifts it — the star is an explicit "keep this in my face".
    const aCodexInbox = isCodexInboxProject(projectA);
    const bCodexInbox = isCodexInboxProject(projectB);
    if (aCodexInbox !== bCodexInbox) {
      return aCodexInbox ? 1 : -1;
    }

    if (projectSortOrder === 'date') {
      return compareProjectsByNewestCreated(projectA, projectB);
    }

    return (projectA.displayName || projectA.projectId).localeCompare(projectB.displayName || projectB.projectId);
  });

  return byName;
};

export const RECENT_JOURNAL_LIMIT = 20;

/**
 * Builds the Recent journal: which sessions appear is decided by activity,
 * how folders and cards are stacked is decided by creation time (or a pinned
 * drag order). Two parallel runs therefore cannot swap places mid-reply.
 */
export const buildRecentProjects = (
  sortedProjects: Project[],
  hiddenSessions: Record<string, string>,
  sessionOrderByProject: Record<string, string[]>,
  limit: number = RECENT_JOURNAL_LIMIT,
): Project[] => {
  const flattened = sortedProjects.flatMap((project) =>
    getAllSessions(project).map((session) => ({ project, session })),
  );

  flattened.sort(
    (a, b) => getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime(),
  );

  const visible = flattened.filter(({ session }) =>
    isSessionVisibleInRecentJournal(session, hiddenSessions),
  );

  const top = visible.slice(0, limit);

  const byProjectId = new Map<string, Project>();
  for (const { project, session } of top) {
    const existing = byProjectId.get(project.projectId);
    if (existing) {
      existing.sessions = [...(existing.sessions ?? []), session];
      continue;
    }
    byProjectId.set(project.projectId, {
      ...project,
      sessions: [session],
      sessionMeta: {
        ...project.sessionMeta,
        hasMore: false,
      },
    });
  }

  return [...byProjectId.values()]
    .sort(compareProjectsByNewestCreated)
    .map((project) => {
      const sessions = [...(project.sessions ?? [])].sort(
        (a, b) =>
          getSessionCreatedDate(b as SessionWithProvider).getTime()
          - getSessionCreatedDate(a as SessionWithProvider).getTime(),
      ) as SessionWithProvider[];

      return {
        ...project,
        sessions: applyManualSessionOrder(sessions, sessionOrderByProject[project.projectId]),
        sessionMeta: {
          ...project.sessionMeta,
          total: sessions.length,
          hasMore: false,
        },
      };
    });
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
  const projectPath = getProjectPath(project);
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
