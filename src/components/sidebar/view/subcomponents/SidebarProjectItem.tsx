import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Pencil, Star, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';
import { HIDE_PROJECTS } from '../../../../utils/instanceConfig';
import ProjectIcon from '../../../app-icon/ProjectIcon';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { isCodexInboxProject } from '../../utils/utils';
import {
  PROJECT_CARD_LONG_PRESS_MS,
  movedTooFar,
  projectMenuPosition,
  type Point,
} from '../../utils/projectCardMenu';

import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  isRecentView?: boolean;
  isFoldOnlyHeader?: boolean;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteSession: (session: SessionWithProvider, sessionName: string) => void;
  onReorderSessions: (projectId: string, orderedSessionIds: string[]) => void;
  t: TFunction;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onSessionSelect,
  onLoadMoreSessions,
  activeSessions,
  isRecentView = false,
  isFoldOnlyHeader = false,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onDeleteSession,
  onReorderSessions,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const isSelected = selectedProject?.projectId === project.projectId;
  const isEditing = editingProject === project.projectId;
  const toggleProject = () => onToggleProject(project.projectId);
  const toggleStarProject = () => onToggleStarProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId);
  };

  // Phone card: pin/rename live behind a long press (see projectCardMenu.ts).
  const pressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<Point | null>(null);
  const suppressTapRef = useRef(false);
  const [cardMenu, setCardMenu] = useState<{ left: number; top: number } | null>(null);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  useEffect(() => clearPressTimer, []);

  const openCardMenu = (point: Point) => {
    clearPressTimer();
    suppressTapRef.current = true;
    setCardMenu(projectMenuPosition(point, { width: window.innerWidth, height: window.innerHeight }));
  };

  const closeCardMenu = () => setCardMenu(null);

  const handleCardTap = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    toggleProject();
  };

  const longPressHandlers = isEditing
    ? {}
    : {
        onPointerDown: (event: ReactPointerEvent) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          clearPressTimer();
          suppressTapRef.current = false;
          const point = { x: event.clientX, y: event.clientY };
          pressStartRef.current = point;
          pressTimerRef.current = window.setTimeout(() => openCardMenu(point), PROJECT_CARD_LONG_PRESS_MS);
        },
        onPointerMove: (event: ReactPointerEvent) => {
          const start = pressStartRef.current;
          if (!start || pressTimerRef.current === null) return;
          if (movedTooFar(start, { x: event.clientX, y: event.clientY })) clearPressTimer();
        },
        onPointerUp: clearPressTimer,
        onPointerCancel: clearPressTimer,
        onContextMenu: (event: ReactMouseEvent) => {
          // Android Chrome fires contextmenu on a long press — reuse it, and
          // keep the browser's own text-selection/link menu out of the way.
          event.preventDefault();
          if (!cardMenu) openCardMenu({ x: event.clientX, y: event.clientY });
        },
      };

  const selectAndToggleProject = () => {
    // In the journal views (Running/Recent) the header is a pure fold handle:
    // folding a group away must never switch the workspace out of the chat the
    // user currently has open.
    if (!isFoldOnlyHeader && selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}>
      {/* An instance pinned to one folder (VITE_HIDE_PROJECTS) has nothing to
          pick between, so the folder header — rename, star, fold, switch —
          is dead weight. The project itself still exists and still owns the
          sessions rendered below. */}
      {!HIDE_PROJECTS && (
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              'select-none [-webkit-touch-callout:none]',
              isSelected && 'bg-primary/5 border-primary/20',
              isStarred &&
                !isSelected &&
                !isRecentView &&
                'bg-warning/5 border-warning/20',
            )}
            onClick={handleCardTap}
            {...longPressHandlers}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ProjectIcon project={project} size="md" starred={isStarred && !isRecentView} />

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) => onEditingNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          saveProjectName();
                        }

                        if (event.key === 'Escape') {
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
                        {isCodexInboxProject(project) && (
                          <SessionProviderLogo provider="codex" className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        )}
                        <h3 className="truncate text-sm font-normal text-foreground" title={project.fullPath}>{project.displayName}</h3>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-success text-success-foreground shadow-sm transition-all duration-150 active:scale-90 active:shadow-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground shadow-sm transition-all duration-150 active:scale-90 active:shadow-none"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* No tappable star here: it sat next to the chevron and
                        unpinned projects on a missed tap. Pinned state shows as
                        a static mark; pin/unpin is a long press on the card. */}
                    {isStarred && !isRecentView && (
                      <Star aria-hidden className="h-3 w-3 fill-current text-warning" />
                    )}
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {cardMenu && typeof document !== 'undefined' && createPortal(
            <div
              className="fixed inset-0 z-[100]"
              // Close on click, not pointerdown: otherwise the same tap falls
              // through to the chat row underneath once the overlay is gone.
              onClick={closeCardMenu}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                role="menu"
                className="absolute min-w-[220px] overflow-hidden rounded-2xl bg-background/95 py-1 shadow-[0_18px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/15 backdrop-blur-xl"
                style={{ left: cardMenu.left, top: cardMenu.top }}
                onClick={(event) => event.stopPropagation()}
              >
                {!isRecentView && (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground active:bg-accent/70"
                    onClick={() => {
                      closeCardMenu();
                      toggleStarProject();
                    }}
                  >
                    <Star className={cn('h-4 w-4', isStarred && 'fill-current text-warning')} />
                    {isStarred
                      ? t('projects.unpinProject', 'Открепить')
                      : t('projects.pinProject', 'Закрепить')}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground active:bg-accent/70"
                  onClick={() => {
                    closeCardMenu();
                    onStartEditingProject(project);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  {t('projects.renameProject')}
                </button>
              </div>
            </div>,
            document.body,
          )}
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden md:flex w-full justify-between p-2 h-auto font-normal hover:bg-accent/50',
            isSelected && 'bg-accent text-accent-foreground',
            isStarred &&
              !isSelected &&
              !isRecentView &&
              'bg-warning/5 hover:bg-warning/10',
          )}
          onClick={selectAndToggleProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <ProjectIcon project={project} size="sm" starred={isStarred && !isRecentView} />
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => onEditingNameChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        saveProjectName();
                      }
                      if (event.key === 'Escape') {
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-normal text-foreground" title={project.fullPath}>
                  {isCodexInboxProject(project) && (
                    <SessionProviderLogo provider="codex" className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{project.displayName}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-success transition-colors duration-fast ease-ui hover:bg-success/10"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors duration-fast ease-ui hover:bg-muted hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                {!isRecentView && (
                  <div
                    className={cn(
                      'flex h-6 w-6 cursor-pointer items-center justify-center rounded opacity-40 transition-opacity group-hover:opacity-100',
                      isStarred && 'opacity-100',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStarProject();
                    }}
                    title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  >
                    <Star
                      className={cn(
                        'h-3 w-3',
                        isStarred ? 'fill-current text-warning' : 'text-muted-foreground',
                      )}
                    />
                  </div>
                )}
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </>
            )}
          </div>
        </Button>
      </div>
      )}

      <SidebarProjectSessions
        project={project}
        isExpanded={HIDE_PROJECTS || isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        isRecentView={isRecentView}
        currentTime={currentTime}
        editingSession={editingSession}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onDeleteSession={onDeleteSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        onReorderSessions={onReorderSessions}
        t={t}
      />
    </div>
  );
}
