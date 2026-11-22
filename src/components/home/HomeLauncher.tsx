import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../types/app';
import { cn } from '../../lib/utils';
import NeonTile from '../app-icon/neon/NeonTile';
import MobileMenuButton from '../main-content/view/subcomponents/MobileMenuButton';

import HomeAllProjectsFolder from './HomeAllProjectsFolder';
import HomeProjectTile from './HomeProjectTile';
import HomeSearchField from './HomeSearchField';
import type { GridSize } from './homeGridLayout';
import { buildHomeProjects, isHomeJunkProject } from './homeProjectsModel';
import { useGridCapacity } from './useGridCapacity';
import { useProjectTileMenu } from './useProjectTileMenu';

type HomeLauncherProps = {
  projects: Project[];
  isMobile: boolean;
  onMenuClick: () => void;
  onProjectSelect: (project: Project) => void;
  onShowSettings: () => void;
  onToggleStarProject?: (projectId: string) => void;
  /** Grid area size until the first measurement (server render, previews). */
  initialGridSize?: GridSize;
};

const ALL_TILE_ACCENT = '#7DD3FC';
const SETTINGS_ACCENT = '#7DD3FC';
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
  initialGridSize,
}: HomeLauncherProps) {
  const { t } = useTranslation();
  const { time, date } = useClock();
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const layout = useGridCapacity(gridAreaRef, initialGridSize);
  const menu = useProjectTileMenu(onToggleStarProject);
  const [query, setQuery] = useState('');
  const [folderOpen, setFolderOpen] = useState(false);

  const searching = query.trim().length > 0;
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
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 p-2 sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 pt-5 sm:px-8 sm:pt-7 lg:px-10">
        <div className="mb-4 shrink-0 text-center sm:mb-6">
          {/* Digits stay centred; the settings button hangs off their right edge. */}
          <div className="relative inline-block" data-home-clock>
            <p className="text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl">
              {time}
            </p>
            <button
              type="button"
              className="neo3-neon neo3-neon-round absolute left-full top-1/2 ml-3 inline-flex h-10 w-10 -translate-y-1/2 overflow-hidden outline-none transition-transform duration-150 ease-out hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 sm:ml-4"
              onClick={onShowSettings}
              aria-label={t('mainContent.homeSettings', 'Settings')}
              title={t('mainContent.homeSettings', 'Settings')}
              data-home-settings
            >
              <NeonTile
                glyph="settings"
                accent={SETTINGS_ACCENT}
                size={40}
                shape="circle"
                showMark={false}
                className="h-full w-full"
              />
            </button>
          </div>
          <p className="mt-1.5 text-sm capitalize text-muted-foreground">{date}</p>
        </div>

        {realProjectCount > SEARCH_MIN_PROJECTS && (
          <div className="mb-4 shrink-0">
            <HomeSearchField value={query} onChange={setQuery} />
          </div>
        )}

        <div
          ref={gridAreaRef}
          className={cn('min-h-0 flex-1 pb-3 pt-1 sm:pb-6', searching ? 'overflow-y-auto' : 'overflow-hidden')}
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
