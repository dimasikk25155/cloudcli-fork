import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Folder, GitBranch, BarChart3 } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';
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
import { downloadFile } from '../../../utils/fileDownload';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import FolderModal from '../../file-browser/FolderModal';
import MissingFileModal, { type PathMatch } from '../../file-browser/MissingFileModal';
import { useModEnabled } from '../../../hooks/useModEnabled';
import {
  WorkbenchCanvas,
  WorkbenchLayout,
  WorkbenchToggle,
  openWorkbenchTab,
  useWorkbench,
  useWorkbenchAccountSync,
} from '../../workbench';

import MainContentHeader from './subcomponents/MainContentHeader';
import ShellModeSwitcher from './subcomponents/ShellModeSwitcher';
import { resolveActiveTab } from './subcomponents/mainContentTabs';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

// Готовые документы и архивы из чата сразу скачиваются: смотреть их внутри
// Neo3 негде (на телефоне PDF в окне не показывается вовсе), а штатный
// загрузчик браузера открывает их своим просмотрщиком.
const DOWNLOAD_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'apk', 'aab', 'ipa', 'dmg', 'exe', 'msi',
]);

const shouldDownload = (filePath: string): boolean =>
  DOWNLOAD_EXTENSIONS.has(filePath.split('.').pop()?.toLowerCase() ?? '');

function MainContent({
  selectedProject,
  selectedSession,
  projects = [],
  onProjectSelect,
  activeTab: rawActiveTab,
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
  onGoHome,
  onToggleStarProject,
  externalMessageUpdate,
  newSessionTrigger,
  onStartNewChat,
}: MainContentProps) {
  const { theme } = useTheme();
  // «Рабочий стол»: chat on the left, the canvas on the right (desktop) or
  // full-screen over the chat (phone). Off — the chat renders as before.
  const workbenchOn = useModEnabled('modWorkbench');
  // With the workbench on the chat is the only main view; terminal, files, … are canvas tabs.
  const activeTab = resolveActiveTab(workbenchOn, rawActiveTab);
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter, sendByDoubleEnter } = preferences;

  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  // Terminal tab: agent CLI session (default) vs a real interactive shell.
  const [shellMode, setShellMode] = useState<'agent' | 'plain'>('agent');

  const shouldShowBrowserTab = browserUseEnabled;

  const autopilot = useAutopilotDashboard(selectedProject?.projectId);

  const workbench = useWorkbench(selectedSession?.id ?? null);
  useWorkbenchAccountSync();
  const [mobileCanvasOpen, setMobileCanvasOpen] = useState(false);
  // Once opened the phone canvas stays in the DOM (hidden), so a live terminal is not cut off by «Назад».
  const [mobileCanvasMounted, setMobileCanvasMounted] = useState(false);
  useEffect(() => {
    if (rawActiveTab !== 'chat' && workbenchOn) setActiveTab('chat');
  }, [rawActiveTab, workbenchOn, setActiveTab]);
  useEffect(() => {
    if (mobileCanvasOpen) setMobileCanvasMounted(true);
  }, [mobileCanvasOpen]);
  useEffect(() => {
    if (!isMobile || !workbenchOn) setMobileCanvasMounted(false);
  }, [isMobile, workbenchOn]);
  const lastOpenSeq = useRef(workbench.openSeq);
  useEffect(() => {
    // A tab opened from the chat on a phone shows the canvas at once.
    if (workbench.openSeq !== lastOpenSeq.current) {
      lastOpenSeq.current = workbench.openSeq;
      if (isMobile && workbenchOn) setMobileCanvasOpen(true);
    }
  }, [workbench.openSeq, isMobile, workbenchOn]);
  useEffect(() => {
    if (!isMobile || !workbenchOn || activeTab !== 'chat') setMobileCanvasOpen(false);
  }, [isMobile, workbenchOn, activeTab]);

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
  // The canvas «Файлы» tab opens plain files; a diff only comes from git views.
  const canvasFileOpen = useCallback((filePath: string) => handleFileOpen(filePath), [handleFileOpen]);

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

  const openResolvedFile = useCallback(
    (filePath: string) => {
      const projectId = selectedProject?.projectId;
      if (projectId && shouldDownload(filePath)) {
        downloadFile(projectId, filePath);
        return;
      }
      openFileAsModal(filePath);
    },
    [openFileAsModal, selectedProject?.projectId],
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
          openResolvedFile(info.path);
          return;
        }
        const matches: PathMatch[] = info.matches ?? [];
        // Агент ошибся папкой, а файл с таким именем один — открываем его,
        // без окна-посредника. Окно нужно, только когда выбирать есть из чего
        // или файла нет вовсе.
        if (matches.length === 1) {
          openResolvedFile(matches[0].path);
          return;
        }
        setMissingFile({ reference: info.path || filePath, matches });
      } catch {
        setOpenAsModal(true);
        resolvedFileOpen(filePath);
      }
    },
    [openResolvedFile, resolvedFileOpen, selectedProject?.projectId, setOpenAsModal],
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
      if (!workbenchOn) setActiveTab('files');
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
    return (
      <MainContentStateView
        mode="empty"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        projects={projects}
        onProjectSelect={onProjectSelect}
        onShowSettings={onShowSettings}
        onToggleStarProject={onToggleStarProject}
      />
    );
  }

  const showDesktopCanvas = workbenchOn && workbench.enabled && !isMobile && activeTab === 'chat' && !editorExpanded;
  const workbenchToggle = workbenchOn ? (
    <WorkbenchToggle
      isMobile={isMobile}
      active={isMobile ? mobileCanvasOpen : workbench.enabled}
      onClick={() => (isMobile ? setMobileCanvasOpen(true) : workbench.setEnabled(!workbench.enabled))}
    />
  ) : null;

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
        onGoHome={onGoHome}
        workbenchToggle={workbenchToggle}
        workbenchOn={workbenchOn}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WorkbenchLayout
          enabled={showDesktopCanvas}
          ratio={workbench.ratio}
          onRatioChange={workbench.setRatio}
          canvas={<WorkbenchCanvas project={selectedProject} session={selectedSession} onFileOpen={canvasFileOpen} />}
        >
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
                sendByDoubleEnter={sendByDoubleEnter}
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
        </WorkbenchLayout>

        {theme === 'codex' && activeTab === 'chat' && !editingFile && !showDesktopCanvas && (
          <aside className="codex-environment" aria-label="Среда проекта">
            <p className="mb-2 text-xs text-muted-foreground">Среда</p>
            {!workbenchOn && <button onClick={() => setActiveTab('git')}><GitBranch size={15} />Изменения</button>}
            <button onClick={() => (workbenchOn ? openWorkbenchTab(selectedSession?.id ?? null, { kind: 'files', title: 'Файлы' }) : setActiveTab('files'))} title={selectedProject.path}><Folder size={15} /><span className="truncate">{String(selectedProject.displayName || selectedProject.name || 'Проект')}</span></button>
            <button onClick={() => (workbenchOn ? openWorkbenchTab(selectedSession?.id ?? null, { kind: 'stats', title: 'Статистика' }) : setActiveTab('stats'))}><BarChart3 size={15} />Статистика проекта</button>
          </aside>
        )}
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

      {workbenchOn && isMobile && (mobileCanvasOpen || mobileCanvasMounted) && (
        <div
          className={`pwa-header-safe fixed inset-0 z-40 flex flex-col bg-background ${mobileCanvasOpen ? '' : 'pointer-events-none invisible'}`}
          data-workbench-mobile
          aria-hidden={mobileCanvasOpen ? undefined : true}
        >
          <WorkbenchCanvas
            project={selectedProject}
            session={selectedSession}
            onBack={() => setMobileCanvasOpen(false)}
            visible={mobileCanvasOpen}
            onFileOpen={canvasFileOpen}
          />
        </div>
      )}

      {folderPath && (
        <FolderModal
          projectId={selectedProject.projectId}
          path={folderPath}
          onClose={() => setFolderPath(null)}
          onOpenFile={(filePath) => {
            setFolderPath(null);
            openResolvedFile(filePath);
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
            openResolvedFile(filePath);
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
