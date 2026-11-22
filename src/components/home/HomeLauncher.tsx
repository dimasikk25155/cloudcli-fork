import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Search, Star, X } from 'lucide-react';

import type { Project } from '../../types/app';
import { cn } from '../../lib/utils';
import ProjectIcon from '../app-icon/ProjectIcon';
import NeonTile from '../app-icon/neon/NeonTile';
import type { NeonGlyph } from '../app-icon/neon/neonGlyphs';
import { fileToIconDataUrl, writeProjectIcon } from '../app-icon/projectIconStorage';
import PlannerAttentionButton, { CountDot } from '../consigliere/PlannerAttentionButton';
import { usePlannerAttention } from '../consigliere/usePlannerAttention';
import { requestHubPanel, type HubPanelKey } from '../hub/hubPanels';
import MobileMenuButton from '../main-content/view/subcomponents/MobileMenuButton';

import { buildHomeProjects, isHomeJunkProject } from './homeProjectsModel';

type HomeLauncherProps = {
  projects: Project[];
  isMobile: boolean;
  onMenuClick: () => void;
  onProjectSelect: (project: Project) => void;
  onShowSettings: () => void;
  onToggleStarProject?: (projectId: string) => void;
};

type DockApp = {
  key: HubPanelKey;
  label: string;
  glyph: NeonGlyph;
  accent: string;
};

type IconMenu = {
  project: Project;
  left: number;
  top: number;
};

// The same neon tiles as the projects below, so Home reads as one grid.
// The sidebar menu keeps its own bright tiles (`menu-icons/`).
const DOCK: DockApp[] = [
  { key: 'consigliere', label: 'Канцелярия', glyph: 'wallet', accent: '#FFC83D' },
  { key: 'mazda', label: 'Мазда', glyph: 'car', accent: '#F43F5E' },
  { key: 'nightshift', label: 'Задачи', glyph: 'tasks', accent: '#A78BFA' },
  { key: 'settings', label: 'Настройки', glyph: 'settings', accent: '#7DD3FC' },
];

const MORE_TILE_ACCENT = '#7DD3FC';
/** Show the search field once there are more real projects than fit two rows. */
const SEARCH_MIN_PROJECTS = 8;

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;

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

function clampMenuPosition(x: number, y: number) {
  const menuWidth = 220;
  const menuHeight = 120;
  const left = Math.min(Math.max(12, x - 20), window.innerWidth - menuWidth - 12);
  const top = Math.min(Math.max(12, y - 8), window.innerHeight - menuHeight - 12);
  return { left, top };
}

export default function HomeLauncher({
  projects,
  isMobile,
  onMenuClick,
  onProjectSelect,
  onShowSettings,
  onToggleStarProject,
}: HomeLauncherProps) {
  const { t } = useTranslation();
  const { time, date } = useClock();
  const { items: attention } = usePlannerAttention();
  const consigliereCount = attention.length;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [iconTarget, setIconTarget] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<IconMenu | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Pinned first, then up to 12 recent; junk folders never (see homeProjectsModel).
  const { items: orderedProjects, hiddenCount } = useMemo(
    () => buildHomeProjects(projects, { now: Date.now(), query, showAll }),
    [projects, query, showAll],
  );
  // How many «Свернуть» would hide again: the collapsed view's hidden count.
  const collapsibleCount = useMemo(
    () => (showAll ? buildHomeProjects(projects, { now: Date.now(), query: '', showAll: false }).hiddenCount : 0),
    [projects, showAll],
  );
  const realProjectCount = useMemo(
    () => projects.filter((project) => !isHomeJunkProject(project)).length,
    [projects],
  );
  const searching = query.trim().length > 0;
  const moreTile: 'all' | 'collapse' | null = searching
    ? null
    : showAll
      ? (collapsibleCount > 0 ? 'collapse' : null)
      : (hiddenCount > 0 ? 'all' : null);

  const visibleDock = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DOCK;
    return DOCK.filter((app) => app.label.toLowerCase().includes(needle));
  }, [query]);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const openMenu = (project: Project, x: number, y: number) => {
    clearPressTimer();
    suppressClickRef.current = true;
    setMenu({ project, ...clampMenuPosition(x, y) });
  };

  const openIconPicker = (projectId: string) => {
    setMenu(null);
    setIconTarget(projectId);
    fileInputRef.current?.click();
  };

  const handleIconFile = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    const projectId = iconTarget;
    setIconTarget(null);
    if (!file || !projectId) return;
    try {
      const dataUrl = await fileToIconDataUrl(file);
      writeProjectIcon(projectId, dataUrl);
    } catch {
      // Ignore a dropped non-image — the existing icon stays.
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDock = (key: HubPanelKey) => {
    if (key === 'settings') {
      onShowSettings();
      return;
    }
    requestHubPanel(key);
  };

  const handleToggleStar = (project: Project) => {
    setMenu(null);
    onToggleStarProject?.(project.projectId);
  };

  useEffect(() => {
    if (!menu) return undefined;

    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="absolute right-3 top-3 z-10 sm:right-5 sm:top-4">
        <PlannerAttentionButton />
      </div>
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 p-2 sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 pt-5 sm:px-8 sm:pt-7 lg:px-10">
        <div className="mb-4 shrink-0 text-center sm:mb-6">
          <p className="text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl">
            {time}
          </p>
          <p className="mt-1.5 text-sm capitalize text-muted-foreground">{date}</p>
        </div>

        {realProjectCount > SEARCH_MIN_PROJECTS && (
          <div className="relative mx-auto mb-4 w-full max-w-sm shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('mainContent.searchProjects', 'Find a project')}
              className="h-9 w-full rounded-full border-0 bg-background/40 pl-9 pr-9 text-sm text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.18)] ring-1 ring-white/10 backdrop-blur-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {query && (
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery('')}
                aria-label={t('buttons.clear', 'Clear')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {orderedProjects.length === 0 && query ? (
          <div className="mx-auto max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
            {t('mainContent.noMatchingProjects', 'No matching projects')}
          </div>
        ) : orderedProjects.length === 0 && projects.length === 0 ? (
          <div className="mx-auto max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
            <p>{t('onboarding.homeEmpty')}</p>
            <p className="mt-2">{t('mainContent.createProjectDesktop')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-x-4 gap-y-6 sm:grid-cols-6 sm:gap-x-5 sm:gap-y-7 lg:grid-cols-8 xl:grid-cols-10">
            {visibleDock.map((app) => (
              <button
                key={`dock-${app.key}`}
                type="button"
                className="flex flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => handleDock(app.key)}
                title={app.label}
              >
                <span className="relative transition-transform duration-150 ease-out hover:-translate-y-0.5 active:scale-95">
                  <span
                    className="neo3-neon relative inline-flex h-[4.25rem] w-[4.25rem] overflow-hidden"
                    data-dock-tile={app.key}
                    aria-hidden="true"
                  >
                    <NeonTile glyph={app.glyph} accent={app.accent} size="lg" className="h-full w-full" />
                  </span>
                  {app.key === 'consigliere' && <CountDot count={consigliereCount} />}
                </span>
                <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/90 sm:text-xs">
                  {app.label}
                </span>
              </button>
            ))}
            {orderedProjects.map((project) => (
              <div key={project.projectId} className="group relative">
                <button
                  type="button"
                  className="flex w-full flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onProjectSelect(project);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(project, event.clientX, event.clientY);
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse' && event.button !== 0) return;
                    clearPressTimer();
                    pressStartRef.current = { x: event.clientX, y: event.clientY };
                    pressTimerRef.current = window.setTimeout(() => {
                      openMenu(project, event.clientX, event.clientY);
                    }, LONG_PRESS_MS);
                  }}
                  onPointerMove={(event) => {
                    const start = pressStartRef.current;
                    if (!start || pressTimerRef.current === null) return;
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    if ((dx * dx) + (dy * dy) > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
                      clearPressTimer();
                    }
                  }}
                  onPointerUp={clearPressTimer}
                  onPointerCancel={clearPressTimer}
                  onPointerLeave={clearPressTimer}
                  title={t('mainContent.homeIconHint', 'Tap to open. Hold to pin or set an icon.')}
                >
                  <span className="relative transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-active:scale-95">
                    <ProjectIcon project={project} size="lg" starred={Boolean(project.isStarred)} />
                  </span>
                  <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/90 sm:text-xs">
                    {project.displayName}
                  </span>
                </button>
                {onToggleStarProject && (
                  <button
                    type="button"
                    className={cn(
                      'absolute right-1 top-0 z-[3] hidden h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-white/15 md:flex',
                      project.isStarred
                        ? 'text-amber-400 opacity-100'
                        : 'opacity-0 group-hover:opacity-100',
                    )}
                    onClick={() => handleToggleStar(project)}
                    title={project.isStarred
                      ? t('mainContent.unpinProject', 'Unpin')
                      : t('mainContent.pinProject', 'Pin')}
                  >
                    <Star className={cn('h-3 w-3', project.isStarred && 'fill-current')} />
                  </button>
                )}
              </div>
            ))}
            {moreTile && (
              <button
                type="button"
                className="group flex flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setShowAll(moreTile === 'all')}
                data-home-more={moreTile}
              >
                <span className="neo3-neon relative inline-flex h-[4.25rem] w-[4.25rem] overflow-hidden transition-transform duration-150 ease-out group-hover:-translate-y-0.5 group-active:scale-95">
                  <NeonTile
                    glyph={moreTile === 'all' ? 'grid' : 'collapse'}
                    accent={MORE_TILE_ACCENT}
                    size="lg"
                    showMark={false}
                    className="h-full w-full"
                  />
                </span>
                <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-foreground/90 sm:text-xs">
                  {moreTile === 'all'
                    ? t('mainContent.homeAllProjects', { defaultValue: 'All projects ({{n}})', n: hiddenCount })
                    : t('mainContent.homeCollapse', 'Collapse')}
                </span>
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {menu && (
        <div className="fixed inset-0 z-50" onPointerDown={() => setMenu(null)}>
          <div
            role="menu"
            className="bg-background/92 absolute min-w-[200px] overflow-hidden rounded-2xl py-1 shadow-[0_18px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/15 backdrop-blur-xl"
            style={{ left: menu.left, top: menu.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {onToggleStarProject && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-accent/70"
                onClick={() => handleToggleStar(menu.project)}
              >
                <Star className={cn('h-4 w-4', menu.project.isStarred && 'fill-current text-amber-400')} />
                {menu.project.isStarred
                  ? t('mainContent.unpinProject', 'Unpin')
                  : t('mainContent.pinProject', 'Pin')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-accent/70"
              onClick={() => openIconPicker(menu.project.projectId)}
            >
              <ImagePlus className="h-4 w-4" />
              {t('mainContent.setProjectIcon', 'Set a custom icon')}
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleIconFile(event.target.files);
        }}
      />
    </div>
  );
}
