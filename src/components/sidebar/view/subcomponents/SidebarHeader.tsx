import { Activity, Folder, FolderPlus, History, Plus, RefreshCw, Search, X, PanelLeftClose, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';
import { HIDE_PROJECTS } from '../../../../utils/instanceConfig';
import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

import Neo3Logo from '../../../branding/Neo3Logo';

const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  recentSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  recentSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || recentSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  const searchPlaceholder = searchMode === 'archived'
    ? t('search.archivedPlaceholder', 'Search archived sessions...')
    : searchMode === 'running'
      ? t('search.runningPlaceholder', 'Search running sessions...')
      : searchMode === 'recent'
        ? t('search.recentPlaceholder', 'Search recent sessions...')
        : t('projects.searchPlaceholder');
  const runningBadgeText = runningSessionsCount > 99 ? '99+' : String(runningSessionsCount);
  const recentBadgeText = recentSessionsCount > 99 ? '99+' : String(recentSessionsCount);

  // claude.ai's own split is two flat text tabs (Home / Code) — no boxes,
  // no icon rail. "Проекты"/"Недавние" get the same treatment; the
  // "Running" indicator doesn't have a claude.ai counterpart, so it rides
  // along as a small pill on the far right instead of a third equal tab.
  type NavTab = { key: 'projects' | 'recent'; icon: LucideIcon; label: string };

  const primaryTabs: NavTab[] = [
    { key: 'projects', icon: Folder, label: t('search.modeProjects') },
    { key: 'recent', icon: History, label: t('search.modeRecent', 'Recent') },
  ];

  const NavTabs = () => (
    !showSearchTools ? null : (
      <div className="flex items-center gap-4">
        {primaryTabs.map(({ key, icon: Icon, label }) => {
          const active = searchMode === key;
          return (
            <button
              key={key}
              onClick={() => onSearchModeChange(key)}
              aria-pressed={active}
              className={cn(
                'sidebar-nav-tab flex items-center gap-1.5 border-b-2 pb-1 text-sm font-normal transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {key === 'recent' && recentSessionsCount > 0 && (
                <span className="text-[11px] text-muted-foreground/70">{recentBadgeText}</span>
              )}
            </button>
          );
        })}

        {runningSessionsCount > 0 && (
          <button
            onClick={() => onSearchModeChange('running')}
            aria-pressed={searchMode === 'running'}
            title={t('search.runningTooltip', 'Running sessions')}
            className={cn(
              'ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              searchMode === 'running'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground hover:text-emerald-500',
            )}
          >
            <Activity className="h-3 w-3" />
            {runningBadgeText}
          </button>
        )}
      </div>
    )
  );

  const LogoBlock = () => (
    <div className="flex min-w-0 items-center gap-2.5">
      <Neo3Logo className="sidebar-logo h-7 w-7 flex-shrink-0" />
      <h1
        className="truncate text-sm font-bold tracking-tight text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-3 pb-2 pt-3 md:block"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            {/* An instance pinned to one folder (VITE_HIDE_PROJECTS) offers no
                way to add another — that is what pins it. */}
            {!HIDE_PROJECTS && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                onClick={onCreateProject}
                title={t('tooltips.createProject')}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Nav tabs + search */}
        <div className="mt-2.5 space-y-2">
          <NavTabs />

          {showSearchTools && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-9 rounded-xl border-0 pl-9 pr-14 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter ? (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              ) : (
                <kbd
                  aria-hidden
                  title={t('tooltips.openCommandPalette')}
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex"
                >
                  {MOD_KEY}
                  <span>K</span>
                </kbd>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://cloudcli.ai/dashboard"
              className="flex min-w-0 items-center gap-2.5 transition-opacity active:opacity-70"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            {!HIDE_PROJECTS && (
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
                onClick={onCreateProject}
              >
                <FolderPlus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav tabs + search */}
        <div className="mt-2.5 space-y-2">
          <NavTabs />

          {showSearchTools && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={searchFilter}
                onChange={(event) => onSearchFilterChange(event.target.value)}
                className="nav-search-input h-10 rounded-xl border-0 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {searchFilter && (
                <button
                  onClick={onClearSearchFilter}
                  aria-label={t('tooltips.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
