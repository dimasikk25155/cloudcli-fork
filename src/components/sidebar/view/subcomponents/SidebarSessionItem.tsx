import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Check, Edit2, Loader2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Tooltip, buttonVariants } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  /** Pinned position in the list — shown as the rank badge. */
  index: number;
  isDragging: boolean;
  dragOffsetY: number;
  onDragPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  shouldSuppressClick: () => boolean;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  isRecentView?: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onDeleteSession: (session: SessionWithProvider, sessionName: string) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  t: TFunction;
};

/**
 * Compact relative time for sidebar rows:
 * <1m, Xm, Xhr, Xd.
 */
const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }

  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

export default function SidebarSessionItem({
  project,
  session,
  index,
  isDragging,
  dragOffsetY,
  onDragPointerDown,
  shouldSuppressClick,
  selectedSession,
  isProcessing,
  needsAttention,
  isRecentView = false,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onDeleteSession,
  onProjectSelect,
  onSessionSelect,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const mobileEditingContainerRef = useRef<HTMLDivElement>(null);
  const showAttentionIndicator = needsAttention && !isSelected;
  const showRecentIndicator = !showAttentionIndicator && !isProcessing && sessionView.isActive;

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  // The rank is the card's pinned position, not a live activity ranking — it
  // only moves when a session is created or the user drags the card.
  const RankMark = () => (
    <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/30 px-0.5 text-[10px] leading-none text-muted-foreground">
      {index + 1}
    </span>
  );

  // While editing, a tap/click outside the rename panel SAVES the typed name
  // (or cancels when it is empty). Silently discarding the edit here was the
  // "rename does not stick" trap: users typed a name and tapped away expecting
  // it to persist. Explicit cancel stays available via Escape / the ✗ button.
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: Event) => {
      const target = event.target as Node;
      const desktop = editingContainerRef.current;
      const mobile = mobileEditingContainerRef.current;
      if ((desktop && desktop.contains(target)) || (mobile && mobile.contains(target))) {
        return;
      }
      if (editingSessionName.trim()) {
        saveEditedSession();
      } else {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  });

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  return (
    <div
      data-session-row
      className={cn(
        // `touch-pan-y` keeps the sidebar scrollable while reserving horizontal
        // gestures; the callout reset stops iOS from popping its link preview
        // on the press-and-hold that starts a reorder.
        'group relative select-none touch-pan-y [-webkit-touch-callout:none]',
        isDragging && 'z-20 opacity-90 shadow-3',
        // While a card is carried, the browser must not also scroll or start a
        // native text/link drag under the finger.
        isDragging && 'touch-none select-none',
      )}
      style={isDragging ? { transform: `translateY(${dragOffsetY}px)` } : undefined}
      onPointerDown={onDragPointerDown}
      onClickCapture={(event) => {
        if (shouldSuppressClick()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {(showAttentionIndicator || showRecentIndicator) && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip
            content={showAttentionIndicator
              ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
              : t('tooltips.activeSessionIndicator')}
            position="right"
          >
            <div
              role="status"
              aria-label={showAttentionIndicator
                ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
                : t('tooltips.activeSessionIndicator')}
              className={cn(
                'h-2 w-2 animate-pulse rounded-full',
                showAttentionIndicator ? 'bg-warning' : 'bg-success',
              )}
            />
          </Tooltip>
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-ui-md bg-card border active:scale-[0.98] transition-all duration-fast ease-ui relative',
            isSelected ? 'bg-primary/5 border-primary/20' : '',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20'
              : !isSelected && sessionView.isActive
              ? 'border-success/30 bg-success/5'
              : 'border-border/30',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            {!isEditing && <RankMark />}

            {isEditing ? (
              <div
                ref={mobileEditingContainerRef}
                className="flex min-w-0 flex-1 items-center gap-1"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-ui-sm border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
                <button
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-ui-sm bg-success/10 active:scale-95"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3.5 w-3.5 text-success" />
                </button>
                <button
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-ui-sm bg-secondary active:scale-95"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                    {isProcessing ? (
                      <span className="ml-auto flex-shrink-0">
                        <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                          </span>
                        </Tooltip>
                      </span>
                    ) : compactSessionAge && (
                      <span className="ml-auto flex-shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center">
                    {sessionView.messageCount > 0 && (
                      <Badge variant="secondary" className="px-1 py-0 text-xs">
                        {sessionView.messageCount}
                      </Badge>
                    )}
                  </div>
                </div>

                <button
                  className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ui-md bg-muted/50 opacity-70 transition-transform active:scale-95"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-muted-foreground" />
                </button>

                <button
                  className="ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ui-md bg-muted/50 opacity-70 transition-transform active:scale-95"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteSession(session, sessionView.sessionName);
                  }}
                  title={isRecentView ? t('tooltips.hideFromRecent', 'Remove from journal') : t('tooltips.deleteSession')}
                >
                  {isRecentView ? (
                    <X className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Trash2 className="h-3 w-3 text-destructive" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <a
          href={`/session/${session.id}`}
          // Native link dragging would hijack the reorder gesture.
          draggable={false}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'h-auto w-full justify-start rounded-ui-md border bg-card p-2 text-left font-normal transition-all duration-fast ease-ui',
            isSelected ? 'border-primary/20 bg-primary/5' : 'border-border/30',
            !isSelected && isProcessing
              ? 'border-border/60 bg-muted/20 hover:bg-muted/25'
              : !isSelected && sessionView.isActive
                ? 'border-success/30 bg-success/5 hover:bg-success/10'
                : 'hover:bg-accent/50',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
          // native right-click menu use the href to open a new tab/window.
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <RankMark />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                {isProcessing ? (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="px-1 py-0 text-xs">{sessionView.messageCount}</Badge>}
              </div>
            </div>
          </div>
        </a>

        <div
          ref={editingContainerRef}
          className={cn(
            'absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 transition-all duration-200',
            isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded-ui-sm border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ui-sm bg-success/10 transition-colors duration-fast ease-ui hover:bg-success/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-success" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ui-sm bg-secondary transition-colors duration-fast ease-ui hover:bg-secondary/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ui-sm bg-secondary transition-colors duration-fast ease-ui hover:bg-secondary/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-muted-foreground" />
                </button>
                <button
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-ui-sm transition-colors duration-fast ease-ui',
                    isRecentView
                      ? 'bg-secondary hover:bg-secondary/70'
                      : 'bg-destructive/10 hover:bg-destructive/20',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteSession(session, sessionView.sessionName);
                  }}
                  title={isRecentView ? t('tooltips.hideFromRecent', 'Remove from journal') : t('tooltips.deleteSession')}
                >
                  {isRecentView ? (
                    <X className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Trash2 className="h-3 w-3 text-destructive" />
                  )}
                </button>
              </>
            )}
          </div>
      </div>
    </div>
  );
}
