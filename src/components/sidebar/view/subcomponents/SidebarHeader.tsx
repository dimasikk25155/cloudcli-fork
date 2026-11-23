import React from 'react';
import { Activity, ChevronLeft, FolderPlus, Home, Plus, RefreshCw, Search, X, PanelLeftClose } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';
import { HIDE_PROJECTS } from '../../../../utils/instanceConfig';
import { cn } from '../../../../lib/utils';
import type { ProjectSortOrder, SessionSortOrder, SidebarSearchMode } from '../../types/types';
import AttentionHubButton from '../../../attention/view/AttentionHubButton';
import Neo3Logo from '../../../branding/Neo3Logo';

import ProjectSortToggle from './ProjectSortToggle';
import SessionSortToggle from './SessionSortToggle';

/**
 * Phone header buttons: round glass, 36 px to the eye and 44 px to the finger.
 * The invisible ::before is laid out from the padding box (34 px inside the
 * 1 px edge), so 5 px past it on every side makes 44.
 */
const PHONE_HEADER_BUTTON =
  "glass-button h-9 w-9 touch-manipulation text-muted-foreground before:absolute before:-inset-[5px] before:content-['']";

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
  onGoHome?: () => void;
  /** Opens the «Ждут тебя» hub. */
  onOpenAttention?: () => void;
  /** Sidebar project order; the switch shows only on the «Проекты» tab when both are given. */
  projectSortOrder?: ProjectSortOrder;
  onProjectSortOrderChange?: (order: ProjectSortOrder) => void;
  sessionSortOrder?: SessionSortOrder;
  onSessionSortOrderChange?: (order: SessionSortOrder) => void;
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
  onGoHome,
  onOpenAttention,
  projectSortOrder,
  onProjectSortOrderChange,
  sessionSortOrder,
  onSessionSortOrderChange,
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

  // One list only (23.11, Dima's voice note): the «Проекты / Недавние» tabs
  // are gone. The row holds the chat order (Новые / Недавние — by his own
  // last message), the project order (🕐 / А–Я) and ⚡N. ⚡N toggles the
  // running view; leaving any other view returns to the projects list.
  const NavTabs = ({ phone = false }: { phone?: boolean }) => (
    !showSearchTools ? null : (
      <div
        className={cn('flex min-w-0 items-center', phone ? 'gap-3' : 'gap-2')}
        data-sidebar-tabs={phone ? 'phone' : 'desktop'}
      >
        {searchMode === 'projects' ? (
          sessionSortOrder && onSessionSortOrderChange && (
            <SessionSortToggle order={sessionSortOrder} onChange={onSessionSortOrderChange} t={t} />
          )
        ) : (
          <button
            type="button"
            onClick={() => onSearchModeChange('projects')}
            className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{t('search.modeProjects')}</span>
          </button>
        )}

        <div className={cn('ml-auto flex flex-shrink-0 items-center', phone ? 'gap-3' : 'gap-2')}>
          {searchMode === 'projects' && projectSortOrder && onProjectSortOrderChange && (
            <ProjectSortToggle order={projectSortOrder} onChange={onProjectSortOrderChange} t={t} />
          )}
          {runningSessionsCount > 0 && (
            <button
              onClick={() => onSearchModeChange(searchMode === 'running' ? 'projects' : 'running')}
              aria-pressed={searchMode === 'running'}
              title={t('search.runningTooltip', 'Running sessions')}
              className={cn(
                // relative: sits above the switch's invisible touch area.
                'relative flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                searchMode === 'running'
                  ? 'bg-success/15 text-success'
                  : 'text-muted-foreground hover:text-success',
              )}
            >
              <Activity className="h-3 w-3" />
              {runningBadgeText}
            </button>
          )}
        </div>
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
            <button
              type="button"
              className="flex min-w-0 items-center gap-2.5 rounded-lg text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onGoHome}
              title={t('tooltips.goHome', 'Home screen')}
            >
              <LogoBlock />
            </button>
          )}

          <div className="flex flex-shrink-0 items-center gap-0.5">
            {onOpenAttention && <AttentionHubButton onClick={onOpenAttention} />}
            {onGoHome && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                onClick={onGoHome}
                title={t('tooltips.goHome', 'Home screen')}
              >
                <Home className="h-3.5 w-3.5" />
              </Button>
            )}
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

      {/* Mobile header. No search field and no Home here: on a phone both live
          in the bottom bar (its search filters this very list), so the title
          is no longer squeezed by four buttons. */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
        data-sidebar-header="phone"
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
            <button
              type="button"
              className="flex min-w-0 items-center gap-2.5 text-left"
              onClick={onGoHome}
              title={t('tooltips.goHome', 'Home screen')}
            >
              <LogoBlock />
            </button>
          )}

          <div className="flex flex-shrink-0 items-center gap-2">
            {onOpenAttention && <AttentionHubButton onClick={onOpenAttention} variant="touch" />}
            <button
              type="button"
              className={PHONE_HEADER_BUTTON}
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label={t('tooltips.refresh')}
              data-sidebar-header-action="refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
            </button>
            {!HIDE_PROJECTS && (
              <button
                type="button"
                className={PHONE_HEADER_BUTTON}
                onClick={onCreateProject}
                aria-label={t('tooltips.createProject')}
                data-sidebar-header-action="create-project"
              >
                <FolderPlus className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav tabs */}
        <div className="mt-2.5">
          <NavTabs phone />
        </div>
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
