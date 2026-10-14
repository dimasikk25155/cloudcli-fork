import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useModEnabled } from '../../../hooks/useModEnabled';
import { useSidebarController } from '../hooks/useSidebarController';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { LLMProvider } from '../../../types/app';
import type { AttentionItem } from '../../attention/types';
import AttentionHub from '../../attention/view/AttentionHub';
import { knownProvider } from '../../attention/utils/provider';
import type { SessionWithProvider, SidebarProps } from '../types/types';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  onGoHome,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { restartRequired, currentVersion } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const paletteOps = usePaletteOps();

  const {
    isSidebarCollapsed,
    expandedProjects,
    expandedJournalProjects,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    searchMode,
    setSearchMode,
    runningSessionsCount,
    recentSessionsCount,
    hideSessionFromRecent,
    expandJournalProject,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    filteredProjects,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    toggleProject,
    reorderProjectSessions,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    activeSessions,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const [isAttentionHubOpen, setAttentionHubOpen] = useState(false);
  const openAttentionHub = useCallback(() => setAttentionHubOpen(true), []);
  // «Ждут тебя» off in «Встроенные моды»: no hub, no hub button.
  const attentionOn = useModEnabled('modAttention');

  // Hub row → the session inside its own project, the same way the archive
  // opens a session: select the project, then the session.
  const openAttentionSession = useCallback((item: AttentionItem) => {
    const project = projects.find((candidate) => candidate.projectId === item.projectId);
    if (project) {
      handleProjectSelect(project);
    }
    const base = { id: item.sessionId, summary: item.title ?? undefined, __projectId: item.projectId || undefined };
    const provider = knownProvider(item.provider);
    if (provider) {
      const session: SessionWithProvider = { ...base, __provider: provider };
      handleSessionClick(session, item.projectId);
      return;
    }
    // Engine this client does not know: open the session without claiming a provider.
    onSessionSelect(base);
  }, [handleProjectSelect, handleSessionClick, onSessionSelect, projects]);

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    expandedJournalProjects,
    editingProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    deletingProjects,
    getProjectSessions,
    loadingMoreProjects,
    activeSessions,
    isJournalView: searchMode === 'running' || searchMode === 'recent',
    isRecentView: searchMode === 'recent',
    isProjectStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onSessionSelect: handleSessionClick,
    onReorderSessions: reorderProjectSessions,
    onLoadMoreSessions: loadMoreSessionsForProject,
    onNewSession: (project) => {
      expandJournalProject(project.projectId);
      onNewSession(project);
    },
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onDeleteSession: (session, sessionName) => {
      if (searchMode === 'recent') {
        // In the Recent journal the ✕ only hides the card from the list — the
        // session and its history are never touched.
        hideSessionFromRecent(session);
        return;
      }
      showDeleteSessionConfirmation(null, session.id, sessionName, session.__provider);
    },
    t,
  };

  return (
    <>
        <SidebarModals
          projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        t={t}
      />

      {attentionOn && isAttentionHubOpen && (
        <AttentionHub onClose={() => setAttentionHubOpen(false)} onOpenSession={openAttentionSession} />
      )}

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={onShowSettings}
          onGoHome={onGoHome}
          onOpenAttention={attentionOn ? openAttentionHub : undefined}
          restartRequired={restartRequired}
          t={t}
        />
      ) : (
        <>
        <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isLoading={isLoading}
            projects={projects}
            runningSessionsCount={runningSessionsCount}
            recentSessionsCount={recentSessionsCount}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            searchFilter={searchFilter}
            onSearchFilterChange={setSearchFilter}
            onClearSearchFilter={() => setSearchFilter('')}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            onRestoreArchivedProject={restoreArchivedProject}
            onArchivedSessionClick={openArchivedSession}
            onRestoreArchivedSession={restoreArchivedSession}
            onDeleteArchivedSession={(session) => {
              showDeleteSessionConfirmation(
                session.projectId,
                session.sessionId,
                session.sessionTitle,
                session.provider,
                { isArchived: true },
              );
            }}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            onCreateProject={() => setShowNewProject(true)}
            onCollapseSidebar={handleCollapseSidebar}
            restartRequired={restartRequired}
            currentVersion={currentVersion}
            onShowSettings={onShowSettings}
            onGoHome={onGoHome}
            onOpenAttention={attentionOn ? openAttentionHub : undefined}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
