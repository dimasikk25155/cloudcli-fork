import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../types/app';
import { cn } from '../../lib/utils';
import NeonTile from '../app-icon/neon/NeonTile';
import SessionHubBar from '../session-hub/SessionHubBar';

import HomeAllProjectsFolder from './HomeAllProjectsFolder';
import HomeClockRow from './HomeClockRow';
import HomeProjectTile from './HomeProjectTile';
import HomeSearchField from './HomeSearchField';
import type { GridSize } from './homeGridLayout';
import { buildHomeProjects, isHomeJunkProject } from './homeProjectsModel';
import { useGridCapacity } from './useGridCapacity';
import { useKeyboardOpen } from './useKeyboardOpen';
import { useProjectTileMenu } from './useProjectTileMenu';

type HomeLauncherProps = {
  projects: Project[];
  isMobile: boolean;
  onMenuClick: () => void;
  onProjectSelect: (project: Project) => void;
  onShowSettings: () => void;
  onToggleStarProject?: (projectId: string) => void;
  /** Open a chat by id (any project) — the status bar's «Диалоги» panel. */
  onOpenSession?: (sessionId: string) => void;
  /** Grid area size until the first measurement (server render, previews). */
  initialGridSize?: GridSize;
};

const ALL_TILE_ACCENT = '#7DD3FC';
/** Show the search field once there are more real projects than fit two rows. */
const SEARCH_MIN_PROJECTS = 8;

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    time: new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    }).format(now),
    date: new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Moscow',
    }).format(now),
  };
}

export default function HomeLauncher({
  projects,
  isMobile,
  onMenuClick,
  onProjectSelect,
  onShowSettings,
  onToggleStarProject,
  onOpenSession,
  initialGridSize,
}: HomeLauncherProps) {
  const { t } = useTranslation();
  const { time, date } = useClock();
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const menu = useProjectTileMenu(onToggleStarProject);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();

  const searching = query.trim().length > 0;
  // Tapping the empty search on an iPhone raises the keyboard, which squeezes
  // the shell: Home used to drop from 4 rows to 1–2 until it closed. While
  // the field is focused (or the keyboard still slides away) and nothing is
  // typed, the rows measured before the tap stay; the area scrolls instead.
  // Sizes measured while squeezed are not remembered: wiping the query with
  // the keyboard still up brings the keyboard-free rows back (review 04).
  const gridSqueezed = searchFocused || keyboardOpen;
  const holdGrid = !searching && gridSqueezed;
  const layout = useGridCapacity(gridAreaRef, initialGridSize, holdGrid, gridSqueezed);
  // Exactly one screen: pinned, then recent; the last cell is «All projects».
  const { items: shownProjects, hiddenCount } = useMemo(
    () => buildHomeProjects(projects, { query, capacity: layout.capacity }),
    [projects, query, layout.capacity],
  );
  const realProjectCount = useMemo(
    () => projects.filter((project) => !isHomeJunkProject(project)).length,
    [projects],
  );

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
    gridAutoRows: `${layout.cellHeight}px`,
    columnGap: layout.columnGap,
    rowGap: layout.rowGap,
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* No ☰ strip on top: on a phone the ☰ sits on the clock line (left),
          settings on the right, and the strip's height goes to the grid —
          one more row on Dima's 430 × 932 iPhone (IMG_0103, 23.11 09:38).
          Phone paddings are trimmed for the same reason (pt-4, mb-3). */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 pt-4 sm:px-8 sm:pt-7 lg:px-10">
        <div className="mb-3 shrink-0 text-center sm:mb-6">
          <HomeClockRow
            time={time}
            onMenuClick={isMobile ? onMenuClick : undefined}
            onShowSettings={onShowSettings}
          />
          <p className="mt-1.5 text-sm capitalize text-muted-foreground">{date}</p>
          {/* The same «работают · ждут · готово» bar as above the chat
              composer (opens «Диалоги»). It hides itself when nothing runs,
              so the slot collapses; the grid below measures what is left. */}
          <div
            className="mt-3 empty:hidden [&_[data-session-hub-bar]]:mb-0 [&_[data-session-hub-bar]]:justify-center"
            data-home-status
          >
            <SessionHubBar onOpenSession={(sessionId) => onOpenSession?.(sessionId)} />
          </div>
        </div>

        {realProjectCount > SEARCH_MIN_PROJECTS && (
          <div className="mb-3 shrink-0 sm:mb-4">
            <HomeSearchField value={query} onChange={setQuery} onFocusChange={setSearchFocused} />
          </div>
        )}

        <div
          ref={gridAreaRef}
          className={cn('min-h-0 flex-1 pb-3 pt-1 sm:pb-6', searching || holdGrid ? 'overflow-y-auto' : 'overflow-hidden')}
          data-home-grid-area
        >
          {shownProjects.length === 0 && searching ? (
            <div className="mx-auto max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
              {t('mainContent.noMatchingProjects', 'No matching projects')}
            </div>
          ) : projects.length === 0 ? (
            <div className="mx-auto max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
              <p>{t('onboarding.homeEmpty')}</p>
              <p className="mt-2">{t('mainContent.createProjectDesktop')}</p>
            </div>
          ) : (
            <div
              className="grid"
              style={gridStyle}
              data-home-grid={`${layout.columns}x${layout.rows}`}
            >
              {shownProjects.map((project) => (
                <HomeProjectTile key={project.projectId} project={project} menu={menu} onOpen={onProjectSelect} />
              ))}
              {!searching && (
                <button
                  type="button"
                  className="group flex min-w-0 flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setFolderOpen(true)}
                  title={hiddenCount > 0
                    ? t('mainContent.homeAllProjects', { defaultValue: 'All projects ({{n}})', n: hiddenCount })
                    : t('mainContent.homeAllProjectsTitle', 'All projects')}
                  data-home-more="all"
                  data-hidden-count={hiddenCount}
                >
                  <span className="neo3-neon relative inline-flex h-[4.25rem] w-[4.25rem] overflow-hidden transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-active:scale-95">
                    <NeonTile
                      glyph="grid"
                      accent={ALL_TILE_ACCENT}
                      size="lg"
                      showMark={false}
                      className="h-full w-full"
                    />
                  </span>
                  <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/90 sm:text-xs">
                    {t('mainContent.homeAllProjectsTitle', 'All projects')}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {folderOpen && (
        <HomeAllProjectsFolder
          projects={projects}
          onClose={() => setFolderOpen(false)}
          onProjectSelect={onProjectSelect}
          onToggleStarProject={onToggleStarProject}
        />
      )}

      {menu.layer}
    </div>
  );
}
