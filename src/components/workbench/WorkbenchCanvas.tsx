import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, LayoutDashboard, Plus, X } from 'lucide-react';

import type { Project, ProjectSession } from '../../types/app';

import './builtinTabs';
import { closeWorkbenchTab, openWorkbenchTab, useWorkbench } from './useWorkbench';
import {
  getWorkbenchTabKind,
  listWorkbenchTabKinds,
  subscribeWorkbenchTabKinds,
  workbenchTabKindsVersion,
  type WorkbenchRenderContext,
  type WorkbenchTabInput,
  type WorkbenchTabKind,
} from './workbenchTabs';

type WorkbenchCanvasProps = {
  project: Project;
  session: ProjectSession | null;
  /** Phone: the canvas covers the chat and «Назад» returns to it. */
  onBack?: () => void;
};

/** Empty-canvas shortcuts, in this order, for the kinds that are registered. */
const EMPTY_SHORTCUTS: Array<{ kind: WorkbenchTabKind; label: string }> = [
  { kind: 'inspector', label: 'Открыть инспектор' },
  { kind: 'limits', label: 'Контекст и лимиты' },
  { kind: 'artifacts', label: 'Результаты' },
];

/** Tab strip + the active tab's body; the empty canvas says what lands here. */
export default function WorkbenchCanvas({ project, session, onBack }: WorkbenchCanvasProps) {
  const sessionId = session?.id ?? null;
  const { tabs, activeTabId, setActive } = useWorkbench(sessionId);
  // Re-render when a later feature registers its kind.
  useSyncExternalStore(subscribeWorkbenchTabKinds, workbenchTabKindsVersion, workbenchTabKindsVersion);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const context: WorkbenchRenderContext = useMemo(() => ({
    sessionId,
    project,
    session,
    openTab: (tab) => openWorkbenchTab(sessionId, tab),
    closeTab: () => {
      if (activeTabId) closeWorkbenchTab(sessionId, activeTabId);
    },
  }), [sessionId, project, session, activeTabId]);

  const menuKinds = listWorkbenchTabKinds().filter(([, def]) => def.inMenu);
  const activeDef = activeTab ? getWorkbenchTabKind(activeTab.kind) : undefined;

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
              {menuKinds.map(([kind, def]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    open({ kind, title: def.defaultTitle });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                >
                  {def.icon}
                  {def.defaultTitle}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        {activeTab && activeDef ? (
          <React.Fragment key={activeTab.id}>{activeDef.render(activeTab, context)}</React.Fragment>
        ) : activeTab ? (
          <p className="p-6 text-sm text-muted-foreground">Эта вкладка недоступна в этой версии Neo3.</p>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center" data-workbench-empty>
            <LayoutDashboard className="h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">
              Здесь появятся результаты, побочные чаты и второй чат
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EMPTY_SHORTCUTS.map(({ kind, label }) => {
                const def = getWorkbenchTabKind(kind);
                if (!def) return null;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => open({ kind, title: def.defaultTitle })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    {def.icon}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
