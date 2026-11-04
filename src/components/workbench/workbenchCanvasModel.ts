import type { ReactNode } from 'react';

import type { WorkbenchMenuContext, WorkbenchTab, WorkbenchTabKind, WorkbenchTabKindDef } from './workbenchTabs';

export type { WorkbenchMenuContext };

export type WorkbenchMenuEntry = {
  key: string;
  kind: WorkbenchTabKind;
  ref?: string;
  title: string;
  icon: ReactNode;
};

export type PluginMenuTab = { name: string; label: string };

/** The «+» menu and the empty canvas share this list: kinds with `inMenu` that are `available`, plugins one by one. */
export function buildWorkbenchMenu(
  kinds: Array<[WorkbenchTabKind, WorkbenchTabKindDef]>,
  context: WorkbenchMenuContext,
  pluginTabs: PluginMenuTab[],
): WorkbenchMenuEntry[] {
  const entries: WorkbenchMenuEntry[] = [];
  for (const [kind, def] of kinds) {
    if (!def.inMenu) continue;
    if (def.available && !def.available(context)) continue;
    if (kind === 'plugin') {
      for (const plugin of pluginTabs) {
        entries.push({ key: `plugin:${plugin.name}`, kind, ref: plugin.name, title: plugin.label, icon: def.icon });
      }
      continue;
    }
    entries.push({ key: kind, kind, title: def.defaultTitle, icon: def.icon });
  }
  return entries;
}

/** Ids of `keepMounted` tabs opened at least once and still present; closing a tab forgets it. */
export function markVisitedKeepMounted(
  visited: ReadonlySet<string>,
  tabs: WorkbenchTab[],
  activeTabId: string | null,
  isKeepMounted: (kind: WorkbenchTabKind) => boolean,
): Set<string> {
  const next = new Set<string>();
  for (const tab of tabs) {
    if (!isKeepMounted(tab.kind)) continue;
    if (visited.has(tab.id) || tab.id === activeTabId) next.add(tab.id);
  }
  return next;
}

export type CanvasPane = { tab: WorkbenchTab; hidden: boolean };

/** What to keep in the DOM: the active tab plus visited `keepMounted` tabs (hidden), in tab order. */
export function planCanvasPanes({
  tabs,
  activeTabId,
  visited,
  isKeepMounted,
}: {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  visited: ReadonlySet<string>;
  isKeepMounted: (kind: WorkbenchTabKind) => boolean;
}): CanvasPane[] {
  const panes: CanvasPane[] = [];
  for (const tab of tabs) {
    const active = tab.id === activeTabId;
    if (active) panes.push({ tab, hidden: false });
    else if (isKeepMounted(tab.kind) && visited.has(tab.id)) panes.push({ tab, hidden: true });
  }
  return panes;
}
