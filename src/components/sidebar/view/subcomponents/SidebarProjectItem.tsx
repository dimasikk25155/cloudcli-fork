import { Check, ChevronDown, ChevronRight, Star, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';

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
  attentionSessionIds: ReadonlySet<string>;
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
  attentionSessionIds,
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
      <div className="md:group group">
        <div className="md:hidden">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
              isStarred &&
                !isSelected &&
                !isRecentView &&
                'bg-warning/5 border-warning/20',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {!isRecentView && (
                  <button
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center active:scale-90 transition-all duration-150 border',
                      isStarred
                        ? 'bg-warning/10 border-warning/30'
                        : 'bg-muted border-border',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleStarProject();
                    }}
                    title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  >
                    <Star
                      className={cn(
                        'w-4 h-4 transition-colors',
                        isStarred
                          ? 'text-warning fill-current'
                          : 'text-muted-foreground',
                      )}
                    />
                  </button>
                )}

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
                      <div className="flex min-w-0 flex-1 items-center justify-between">
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
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {!isRecentView && (
              <div
                className={cn(
                  'w-6 h-6 flex items-center justify-center rounded cursor-pointer transition-all duration-200',
                  isStarred
                    ? 'hover:bg-warning/10'
                    : 'opacity-40 hover:opacity-100 hover:bg-accent',
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleStarProject();
                }}
                title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
              >
                <Star
                  className={cn(
                    'w-3 h-3 transition-colors',
                    isStarred
                      ? 'text-warning fill-current'
                      : 'text-muted-foreground',
                  )}
                />
              </div>
            )}
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
                <div className="truncate text-sm font-normal text-foreground" title={project.fullPath}>
                  {project.displayName}
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
            ) : isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            )}
          </div>
        </Button>
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        attentionSessionIds={attentionSessionIds}
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
