import { MessageSquare, Terminal, Folder, BarChart3, Gauge, type LucideIcon } from 'lucide-react';

import type { AppTab } from '../../../../types/app';

export type BuiltInTab = {
  kind: 'builtin';
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

export type PluginTab = {
  kind: 'plugin';
  id: AppTab;
  label: string;
  pluginName: string;
  iconFile: string;
};

export type TabDefinition = BuiltInTab | PluginTab;

export type PluginLike = {
  enabled: boolean;
  name: string;
  displayName: string;
  icon: string;
};

const BASE_TABS: BuiltInTab[] = [
  { kind: 'builtin', id: 'chat', labelKey: 'tabs.chat', icon: MessageSquare },
  { kind: 'builtin', id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { kind: 'builtin', id: 'files', labelKey: 'tabs.files', icon: Folder },
  { kind: 'builtin', id: 'stats', labelKey: 'tabs.stats', icon: BarChart3 },
];

export const AUTOPILOT_TAB: BuiltInTab = {
  kind: 'builtin',
  id: 'autopilot',
  labelKey: 'tabs.autopilot',
  icon: Gauge,
};

const BUILTIN_STATS_PLUGIN = 'project-stats';
export const COMPACT_TAB_LABELS_KEY = 'neo3-compact-tab-labels';

export function readCompactTabLabels(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(COMPACT_TAB_LABELS_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function tabShowsLabel(tab: TabDefinition, compactLabels: boolean): boolean {
  if (!compactLabels) return true;
  return tab.id === 'autopilot';
}

export function assembleMainTabs({
  terminalDisabled,
  shouldShowAutopilotTab,
  plugins,
  localize,
}: {
  terminalDisabled: boolean;
  shouldShowAutopilotTab: boolean;
  plugins: PluginLike[];
  localize: (name: string, displayName: string) => string;
}): TabDefinition[] {
  const builtInTabs = BASE_TABS.filter((tab) => !(terminalDisabled && tab.id === 'shell'));
  const pluginTabs: PluginTab[] = plugins
    .filter((plugin) => plugin.enabled && plugin.name !== BUILTIN_STATS_PLUGIN)
    .map((plugin) => ({
      kind: 'plugin' as const,
      id: `plugin:${plugin.name}` as AppTab,
      label: localize(plugin.name, plugin.displayName),
      pluginName: plugin.name,
      iconFile: plugin.icon,
    }));

  return [
    ...builtInTabs,
    ...pluginTabs,
    ...(shouldShowAutopilotTab ? [AUTOPILOT_TAB] : []),
  ];
}
