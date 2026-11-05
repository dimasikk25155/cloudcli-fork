import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LayoutDashboard, Plus, X } from 'lucide-react';

import type { Project, ProjectSession } from '../../types/app';
import { useAuth } from '../auth/context/AuthContext';
import { useAutopilotDashboard } from '../autopilot/useAutopilotDashboard';
import { listPluginTabs } from '../main-content/view/subcomponents/mainContentTabs';
import { localizePluginName } from '../plugins/utils/pluginDisplayName';
import { usePlugins } from '../../contexts/PluginsContext';
import { useModEnabled } from '../../hooks/useModEnabled';

import { confirmDiscardUnsaved } from './artifact-editor/editorStore';
import { pendingArtifactPath } from './artifacts/artifactModel';
import './builtinTabs';
import './projectTabs';
import WorkbenchLauncher from './WorkbenchLauncher';
import {
  closeWorkbenchTab,
  openNewWorkbenchTab,
  openWorkbenchTab,
  replaceWorkbenchTab,
  useWorkbench,
} from './useWorkbench';
import {
  buildWorkbenchMenu,
  markVisitedKeepMounted,
  planCanvasPanes,
  type WorkbenchMenuEntry,
} from './workbenchCanvasModel';
import {
  getWorkbenchTabKind,
  isNewTabKind,
  listWorkbenchTabKinds,
  subscribeWorkbenchTabKinds,
  workbenchTabKindsVersion,
  type WorkbenchChatRuntime,
  type WorkbenchRenderContext,
  type WorkbenchTab,
  type WorkbenchTabKind,
  type WorkbenchTabInput,
} from './workbenchTabs';

/**
 * Closing an artifact tab with unsaved «Правка» edits asks first — also when
 * the editor is not on screen (the edits live in `editorStore`).
 */
function mayCloseTab(tab: WorkbenchTab): boolean {
  if (tab.kind !== 'artifact' || !tab.ref || typeof window === 'undefined') return true;
  const filePath = pendingArtifactPath(tab.ref);
  return confirmDiscardUnsaved(filePath ? { path: filePath } : { artifactId: tab.ref }, (text) => window.confirm(text));
}

type WorkbenchCanvasProps = {
  project: Project;
  session: ProjectSession | null;
  /** Phone: the canvas covers the chat and «Назад» returns to it. */
  onBack?: () => void;
  /** False while the canvas is kept in the DOM but not on screen (phone overlay closed): terminals keep their size. */
  visible?: boolean;
  /** Opens a project file in the editor — for the «Файлы» tab. */
  onFileOpen?: (filePath: string, diff?: unknown) => void;
  /** Processing map and callbacks for chat tabs (a real ChatInterface runs there). */
  chatRuntime?: WorkbenchChatRuntime;
};

/** Tab strip + the active tab's body; the empty canvas says what lands here. */
export default function WorkbenchCanvas({ project, session, onBack, visible = true, onFileOpen, chatRuntime }: WorkbenchCanvasProps) {
  const sessionId = session?.id ?? null;
  const { tabs, activeTabId, setActive } = useWorkbench(sessionId);
  // Re-render when a later feature registers its kind.
  useSyncExternalStore(subscribeWorkbenchTabKinds, workbenchTabKindsVersion, workbenchTabKindsVersion);
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const { terminalDisabled, user } = useAuth();
  const safariLiveOn = useModEnabled('modSafariLive');
  const safariLiveAvailable = user?.role === 'admin' && safariLiveOn;
  const autopilot = useAutopilotDashboard(project.projectId);
  const visitedRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  // Who gets focus once the next tab becomes active: the first launcher icon («+») or the tab itself (a picked icon).
  const focusRequestRef = useRef<'launcher' | 'tab' | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const open = (tab: WorkbenchTabInput) => openWorkbenchTab(sessionId, tab);
  const close = (tab: WorkbenchTab) => {
    if (mayCloseTab(tab)) closeWorkbenchTab(sessionId, tab.id);
  };
  const isKeepMounted = (kind: WorkbenchTabKind) => Boolean(getWorkbenchTabKind(kind)?.keepMounted);
  visitedRef.current = markVisitedKeepMounted(visitedRef.current, tabs, activeTabId, isKeepMounted);
  const panes = planCanvasPanes({ tabs, activeTabId, visited: visitedRef.current, isKeepMounted });
  // closeTab closes the tab it was given to: a kept-mounted chat tab may
  // retarget itself while another tab is the active one.
  const contextFor = (ownTab: WorkbenchTab, isActive: boolean): WorkbenchRenderContext => ({
    sessionId,
    project,
    session,
    openTab: (tab) => openWorkbenchTab(sessionId, tab),
    closeTab: () => close(ownTab),
    replaceTab: (tab) => replaceWorkbenchTab(sessionId, ownTab.id, tab, { keepActive: true }),
    isActive: isActive && visible,
    onFileOpen,
    chatRuntime,
  });

  useEffect(() => {
    const request = focusRequestRef.current;
    focusRequestRef.current = null;
    const root = canvasRef.current;
    if (!request || !root || !activeTabId) return;
    const target =
      request === 'launcher'
        ? root.querySelector<HTMLElement>(`[data-workbench-pane="${CSS.escape(activeTabId)}"] [data-workbench-launcher] button`)
        : root.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(activeTabId)}"]`);
    target?.focus();
  }, [activeTabId]);

  const menuEntries = buildWorkbenchMenu(
    listWorkbenchTabKinds(),
    { autopilotAvailable: autopilot.available, terminalDisabled, safariLiveAvailable },
    listPluginTabs(plugins, (name, displayName) => localizePluginName(name, displayName, t)).map((tab) => ({
      name: tab.pluginName,
      label: tab.label,
    })),
  );
  const toInput = (entry: WorkbenchMenuEntry): WorkbenchTabInput => ({ kind: entry.kind, title: entry.title, ref: entry.ref });
  const openEntry = (entry: WorkbenchMenuEntry) => {
    focusRequestRef.current = 'tab';
    open(toInput(entry));
  };

  return (
    <div ref={canvasRef} className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background" data-workbench-canvas>
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/70 px-2 py-1.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mr-1 inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-foreground hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Назад
          </button>
        )}
        <div role="tablist" aria-label="Вкладки холста" className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const def = getWorkbenchTabKind(tab.kind);
            const selected = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex max-w-56 flex-shrink-0 items-center rounded-lg border text-sm transition-colors ${
                  selected ? 'border-border bg-card text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  data-tab-id={tab.id}
                  aria-selected={selected}
                  onClick={() => setActive(tab.id)}
                  className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1"
                >
                  {def?.icon}
                  <span className="truncate">{tab.title || def?.defaultTitle || 'Вкладка'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => close(tab)}
                  aria-label={`Закрыть «${tab.title || def?.defaultTitle || 'вкладку'}»`}
                  className="mr-1 grid h-5 w-5 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            focusRequestRef.current = 'launcher';
            openNewWorkbenchTab(sessionId);
          }}
          aria-label="Новая вкладка"
          title="Новая вкладка"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Hidden panes use `invisible`, not `display: none`: a terminal measured at 0×0 would shrink its PTY. */}
      <div className="relative min-h-0 flex-1" role="tabpanel">
        {panes.map(({ tab, hidden }) => {
          const def = getWorkbenchTabKind(tab.kind);
          return (
            <div
              key={tab.id}
              className={`absolute inset-0 overflow-y-auto ${hidden ? 'pointer-events-none invisible' : ''}`}
              aria-hidden={hidden || undefined}
              data-workbench-pane={tab.id}
            >
              {isNewTabKind(tab.kind) ? (
                <div className="flex min-h-full justify-center px-4 pb-10 pt-10 sm:pt-14">
                  <WorkbenchLauncher
                    entries={menuEntries}
                    onPick={(entry) => {
                      focusRequestRef.current = 'tab';
                      replaceWorkbenchTab(sessionId, tab.id, toInput(entry));
                    }}
                  />
                </div>
              ) : def ? def.render(tab, contextFor(tab, !hidden)) : (
                <p className="p-6 text-sm text-muted-foreground">Эта вкладка недоступна в этой версии Neo3.</p>
              )}
            </div>
          );
        })}
        {!activeTab && (
          <div className="absolute inset-0 overflow-y-auto" data-workbench-empty>
            {/* min-h-full + centring inside the scroller: a short panel scrolls instead of cutting the top off. */}
            <div className="flex min-h-full flex-col items-center justify-center gap-4 px-4 py-8 text-center">
              <LayoutDashboard className="h-8 w-8 text-muted-foreground/60" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">
                Здесь появятся результаты, побочные чаты и второй чат
              </p>
              <div className="mt-2 w-full">
                <WorkbenchLauncher entries={menuEntries} onPick={openEntry} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
