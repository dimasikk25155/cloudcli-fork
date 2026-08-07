import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { useSessionReorderDrag } from '../../hooks/useSessionReorderDrag';

import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
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
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  onReorderSessions: (projectId: string, orderedSessionIds: string[]) => void;
  t: TFunction;
};

/** Marks where a dragged card will land. */
function SessionDropLine() {
  return <div className="mx-3 my-0.5 h-0.5 rounded-full bg-primary md:mx-0" />;
}

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  attentionSessionIds,
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
  onLoadMoreSessions,
  onNewSession,
  onReorderSessions,
  t,
}: SidebarProjectSessionsProps) {
  const { drag, handlePointerDown, shouldSuppressClick } = useSessionReorderDrag({
    sessionIds: sessions.map((session) => String(session.id)),
    onReorder: (orderedSessionIds) => onReorderSessions(project.projectId, orderedSessionIds),
  });

  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  // Hide the drop line while the card hovers over the gap it already occupies.
  const dropIndex = drag && drag.insertionIndex !== drag.fromIndex && drag.insertionIndex !== drag.fromIndex + 1
    ? drag.insertionIndex
    : null;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <>
        <div className="px-3 pb-1 pt-1 md:hidden">
          <button
            className="new-session-btn flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
            onClick={() => {
              onProjectSelect(project);
              onNewSession(project);
            }}
          >
            <Plus className="h-3 w-3" />
            {t('sessions.newSession')}
          </button>
        </div>

        <Button
          variant="default"
          size="sm"
          className="new-session-btn hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
          onClick={() => onNewSession(project)}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </Button>
      </>

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          <div data-session-list className="space-y-1">
          {sessions.map((session, index) => (
            <div key={session.id}>
              {dropIndex === index && <SessionDropLine />}
            <SidebarSessionItem
              project={project}
              session={session}
              index={index}
              isDragging={drag?.sessionId === String(session.id)}
              dragOffsetY={drag?.sessionId === String(session.id) ? drag.offsetY : 0}
              onDragPointerDown={(event) => handlePointerDown(event, index, String(session.id))}
              shouldSuppressClick={shouldSuppressClick}
              selectedSession={selectedSession}
              isProcessing={activeSessions.has(session.id)}
              needsAttention={attentionSessionIds.has(session.id)}
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
              t={t}
            />
            </div>
          ))}
          {dropIndex === sessions.length && <SessionDropLine />}
          </div>

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
