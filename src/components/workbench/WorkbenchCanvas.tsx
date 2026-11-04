import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LayoutDashboard, Plus, X } from 'lucide-react';

import type { Project, ProjectSession } from '../../types/app';

import { useAuth } from '../auth/context/AuthContext';
import { useAutopilotDashboard } from '../autopilot/useAutopilotDashboard';
import { listPluginTabs } from '../main-content/view/subcomponents/mainContentTabs';
import { localizePluginName } from '../plugins/utils/pluginDisplayName';
import { usePlugins } from '../../contexts/PluginsContext';

import './builtinTabs';
import './projectTabs';
import { closeWorkbenchTab, openWorkbenchTab, useWorkbench } from './useWorkbench';
import {
  buildWorkbenchMenu,
  markVisitedKeepMounted,
  planCanvasPanes,
  type WorkbenchMenuEntry,
} from './workbenchCanvasModel';
import {
  getWorkbenchTabKind,
  listWorkbenchTabKinds,
  subscribeWorkbenchTabKinds,
  workbenchTabKindsVersion,
  type WorkbenchRenderContext,
  type WorkbenchTabKind,
  type WorkbenchTabInput,
} from './workbenchTabs';

type WorkbenchCanvasProps = {
  project: Project;
  session: ProjectSession | null;
  /** Phone: the canvas covers the chat and «Назад» returns to it. */
  onBack?: () => void;
  /** False while the canvas is kept in the DOM but not on screen (phone overlay closed): terminals keep their size. */
  visible?: boolean;
  /** Opens a project file in the editor — for the «Файлы» tab. */
  onFileOpen?: (filePath: string, diff?: unknown) => void;
};

/** Tab strip + the active tab's body; the empty canvas says what lands here. */
export default function WorkbenchCanvas({ project, session, onBack, visible = true, onFileOpen }: WorkbenchCanvasProps) {
  const sessionId = session?.id ?? null;
  const { tabs, activeTabId, setActive } = useWorkbench(sessionId);
  // Re-render when a later feature registers its kind.
  useSyncExternalStore(subscribeWorkbenchTabKinds, workbenchTabKindsVersion, workbenchTabKindsVersion);
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const { terminalDisabled } = useAuth();
  const autopilot = useAutopilotDashboard(project.projectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const visitedRef = useRef<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const open = (tab: WorkbenchTabInput) => openWorkbenchTab(sessionId, tab);
  const isKeepMounted = (kind: WorkbenchTabKind) => Boolean(getWorkbenchTabKind(kind)?.keepMounted);
  visitedRef.current = markVisitedKeepMounted(visitedRef.current, tabs, activeTabId, isKeepMounted);
  const panes = planCanvasPanes({ tabs, activeTabId, visited: visitedRef.current, isKeepMounted });
  const contextFor = (isActive: boolean): WorkbenchRenderContext => ({
    sessionId,
    project,
    session,
    openTab: (tab) => openWorkbenchTab(sessionId, tab),
    closeTab: () => {
      if (activeTabId) closeWorkbenchTab(sessionId, activeTabId);
    },
    isActive: isActive && visible,
    onFileOpen,
  });

  const menuEntries = buildWorkbenchMenu(
    listWorkbenchTabKinds(),
    { autopilotAvailable: autopilot.available, terminalDisabled },
    listPluginTabs(plugins, (name, displayName) => localizePluginName(name, displayName, t)).map((tab) => ({
      name: tab.pluginName,
      label: tab.label,
    })),
  );
  const openEntry = (entry: WorkbenchMenuEntry) => open({ kind: entry.kind, title: entry.title, ref: entry.ref });

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background" data-workbench-canvas>
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
                  aria-selected={selected}
                  onClick={() => setActive(tab.id)}
                  className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1"
                >
                  {def?.icon}
                  <span className="truncate">{tab.title || def?.defaultTitle || 'Вкладка'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeWorkbenchTab(sessionId, tab.id)}
                  aria-label={`Закрыть «${tab.title || def?.defaultTitle || 'вкладку'}»`}
                  className="mr-1 grid h-5 w-5 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-label="Открыть вкладку"
            title="Открыть вкладку"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-border bg-popover p-1 shadow-lg" role="menu">
              {menuEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openEntry(entry);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                >
                  {entry.icon}
                  <span className="min-w-0 truncate">{entry.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
              {def ? def.render(tab, contextFor(!hidden)) : (
                <p className="p-6 text-sm text-muted-foreground">Эта вкладка недоступна в этой версии Neo3.</p>
              )}
            </div>
          );
        })}
        {!activeTab && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center" data-workbench-empty>
            <LayoutDashboard className="h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">
              Здесь появятся результаты, побочные чаты и второй чат
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {menuEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => openEntry(entry)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                >
                  {entry.icon}
                  {entry.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
