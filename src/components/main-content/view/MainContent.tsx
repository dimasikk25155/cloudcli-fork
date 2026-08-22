import React, { useCallback, useEffect, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import PluginTabContent from '../../plugins/view/PluginTabContent';
import ProjectStatsPanel from '../../project-stats/view/ProjectStatsPanel';
import { BrowserUsePanel } from '../../browser-use';
import AutopilotPanel from '../../autopilot/AutopilotPanel';
import { useAutopilotDashboard } from '../../autopilot/useAutopilotDashboard';
import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { api, authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import FolderModal from '../../file-browser/FolderModal';
import MissingFileModal, { type PathMatch } from '../../file-browser/MissingFileModal';

import MainContentHeader from './subcomponents/MainContentHeader';
import ShellModeSwitcher from './subcomponents/ShellModeSwitcher';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onStartNewChat,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  // Terminal tab: agent CLI session (default) vs a real interactive shell.
  const [shellMode, setShellMode] = useState<'agent' | 'plain'>('agent');

  const shouldShowBrowserTab = browserUseEnabled;

  const autopilot = useAutopilotDashboard(selectedProject?.projectId);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    openAsModal,
    setOpenAsModal,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  // Ссылка из чата может оказаться папкой или вообще ничем, и для каждого случая
  // нужно своё окно. Раньше открывался редактор на всё подряд и показывал
  // `// Error loading file: 404` там, где надо было объяснить словами.
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [missingFile, setMissingFile] = useState<{ reference: string; matches: PathMatch[] } | null>(null);

  const openFileAsModal = useCallback(
    (filePath: string) => {
      setOpenAsModal(true);
      handleFileOpen(filePath);
    },
    [handleFileOpen, setOpenAsModal],
  );

  const openPathFromChat = useCallback(
    async (filePath: string) => {
      const projectId = selectedProject?.projectId;
      if (!projectId) return;

      try {
        const response = await api.pathInfo(projectId, filePath);
        const info = await response.json().catch(() => null);

        if (!response.ok || !info) {
          // Сервер не дал ответа — ведём себя как раньше, лишь бы не потерять клик.
          setOpenAsModal(true);
          resolvedFileOpen(filePath);
          return;
        }

        if (info.isDirectory) {
          setFolderPath(info.path);
          return;
        }
        if (info.exists) {
          // Путь уже разрешён сервером, повторно угадывать его не нужно.
          openFileAsModal(info.path);
          return;
        }
        setMissingFile({ reference: info.path || filePath, matches: info.matches ?? [] });
      } catch {
        setOpenAsModal(true);
        resolvedFileOpen(filePath);
      }
    },
    [openFileAsModal, resolvedFileOpen, selectedProject?.projectId, setOpenAsModal],
  );

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

  // Смена проекта на тот, где автопилот не запускали, не должна оставлять
  // человека на исчезнувшей вкладке с пустым экраном.
  useEffect(() => {
    if (!autopilot.available && activeTab === 'autopilot') {
      setActiveTab('chat');
    }
  }, [autopilot.available, activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      setActiveTab('files');
      handleFileOpen(filePath);
    },
    // Opens links clicked inside chat messages as a centered modal (same as
    // mobile), instead of the desktop side panel used by the file tree.
    openFileInEditor: (filePath: string) => {
      void openPathFromChat(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowBrowserTab={shouldShowBrowserTab}
        shouldShowAutopilotTab={autopilot.available}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionProcessing={onSessionProcessing}
                onSessionIdle={onSessionIdle}
                processingSessions={processingSessions}
                onNavigateToSession={onNavigateToSession}
                onSessionEstablished={onSessionEstablished}
                onShowSettings={onShowSettings}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
                onStartNewChat={selectedProject ? () => onStartNewChat?.(selectedProject) : undefined}
              />
            </ErrorBoundary>
          </div>

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="flex h-full w-full flex-col overflow-hidden">
              <ShellModeSwitcher mode={shellMode} onChange={setShellMode} />
              <div className="min-h-0 flex-1">
                <StandaloneShell
                  key={shellMode}
                  project={selectedProject}
                  session={shellMode === 'plain' ? null : selectedSession}
                  isPlainShell={shellMode === 'plain'}
                  showHeader={false}
                  isActive={activeTab === 'shell'}
                />
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="h-full overflow-hidden">
              <ProjectStatsPanel selectedProject={selectedProject} />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
            </div>
          )}

          {activeTab === 'autopilot' && (
            <div className="h-full overflow-hidden">
              <AutopilotPanel url={autopilot.url} />
            </div>
          )}

          {shouldShowBrowserTab && activeTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
            </div>
          )}

          {activeTab.startsWith('plugin:') && (
            <div className="h-full overflow-hidden">
              <PluginTabContent
                pluginName={activeTab.replace('plugin:', '')}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
              />
            </div>
          )}
        </div>

        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          openAsModal={openAsModal}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={activeTab === 'files'}
        />
      </div>

      {folderPath && (
        <FolderModal
          projectId={selectedProject.projectId}
          path={folderPath}
          onClose={() => setFolderPath(null)}
          onOpenFile={(filePath) => {
            setFolderPath(null);
            openFileAsModal(filePath);
          }}
        />
      )}

      {missingFile && (
        <MissingFileModal
          projectId={selectedProject.projectId}
          reference={missingFile.reference}
          matches={missingFile.matches}
          onClose={() => setMissingFile(null)}
          onOpenFile={(filePath) => {
            setMissingFile(null);
            openFileAsModal(filePath);
          }}
          onOpenFolder={(dirPath) => {
            setMissingFile(null);
            setFolderPath(dirPath);
          }}
        />
      )}
    </div>
  );
}

export default React.memo(MainContent);
