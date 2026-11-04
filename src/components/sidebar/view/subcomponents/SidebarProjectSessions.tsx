import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { useSessionReorderDrag } from '../../hooks/useSessionReorderDrag';
import { useFoldedChats } from '../../hooks/useFoldedChats';
import { buildSessionTree, type SessionTreeRow } from '../../utils/sessionTree';
import { useModEnabled } from '../../../../hooks/useModEnabled';
import { HIDE_PROJECTS } from '../../../../utils/instanceConfig';

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
  // «Побочный чат» on: children (thread / relay / side chat) under their parent, foldable.
  const treeOn = useModEnabled('modSideChat');
  const { folded, toggleFolded } = useFoldedChats();
  const rows: SessionTreeRow<SessionWithProvider>[] = useMemo(
    () => (treeOn
      ? buildSessionTree(sessions, folded)
      : sessions.map((session) => ({ session, depth: 0, childCount: 0, collapsed: false }))),
    [treeOn, sessions, folded],
  );
  const { drag, handlePointerDown, shouldSuppressClick } = useSessionReorderDrag({
    sessionIds: rows.map((row) => String(row.session.id)),
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
    <div className={HIDE_PROJECTS ? 'space-y-1' : 'ml-3 space-y-1 border-l border-border pl-3'}>
      <>
        <div className="px-3 pb-1 pt-1 md:hidden">
          <button
            className="new-session-btn flex h-8 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/70 bg-transparent text-xs font-medium text-muted-foreground transition-all duration-150 hover:bg-accent/60 hover:text-foreground active:scale-[0.98]"
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
          variant="ghost"
          size="sm"
          className="new-session-btn hidden h-8 w-full justify-start gap-2 border border-dashed border-border/70 bg-transparent text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground md:flex"
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
          {rows.map(({ session, depth, childCount, collapsed }, index) => (
            <div
              key={session.id}
              className={childCount > 0 || depth > 0 ? 'relative' : undefined}
              style={depth > 0 ? { paddingLeft: Math.min(depth, 4) * 14 } : undefined}
              data-session-depth={depth || undefined}
            >
              {dropIndex === index && <SessionDropLine />}
              {childCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleFolded(String(session.id))}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Показать вложенные чаты (${childCount})` : 'Свернуть вложенные чаты'}
                  title={collapsed ? `Вложенные чаты: ${childCount}` : 'Свернуть вложенные чаты'}
                  className="absolute -left-3 top-2.5 z-10 grid h-4 w-4 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  style={depth > 0 ? { left: Math.min(depth, 4) * 14 - 12 } : undefined}
                >
                  {collapsed ? <ChevronRight className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                </button>
              )}
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
          {dropIndex === rows.length && <SessionDropLine />}
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
