/**
 * Canvas tab kinds that used to be tabs of the main header: «Терминал»,
 * «Файлы», «Статистика», «Автопилот» and the plugin tabs. With the workbench
 * on they open from the canvas «+» menu. Imported once from `index.ts`.
 */
import React, { useState } from 'react';
import { BarChart3, FileText, Gauge, Puzzle, Terminal } from 'lucide-react';

import AutopilotPanel from '../autopilot/AutopilotPanel';
import { useAutopilotDashboard } from '../autopilot/useAutopilotDashboard';
import FileTree from '../file-tree/view/FileTree';
import ShellModeSwitcher, { type ShellMode } from '../main-content/view/subcomponents/ShellModeSwitcher';
import PluginTabContent from '../plugins/view/PluginTabContent';
import ProjectStatsPanel from '../project-stats/view/ProjectStatsPanel';
import StandaloneShell from '../standalone-shell/view/StandaloneShell';

import { registerWorkbenchTabKind, type WorkbenchRenderContext } from './workbenchTabs';

/** One terminal per tab: the mode is this tab's own state, which survives because the tab is kept mounted. */
function TerminalTab({ context }: { context: WorkbenchRenderContext }) {
  const [mode, setMode] = useState<ShellMode>('agent');
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <ShellModeSwitcher mode={mode} onChange={setMode} />
      <div className="min-h-0 flex-1">
        <StandaloneShell
          key={mode}
          project={context.project}
          session={mode === 'plain' ? null : context.session}
          isPlainShell={mode === 'plain'}
          showHeader={false}
          isActive={context.isActive}
        />
      </div>
    </div>
  );
}

/** Reads the dashboard itself, so the tab works the same from the menu and from a restored layout. */
function AutopilotTab({ projectId }: { projectId: string }) {
  const dashboard = useAutopilotDashboard(projectId);
  return <AutopilotPanel url={dashboard.available ? dashboard.url : null} />;
}

registerWorkbenchTabKind('terminal', {
  defaultTitle: 'Терминал',
  icon: <Terminal className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  keepMounted: true,
  available: (menu) => !menu.terminalDisabled,
  render: (_tab, context) => <TerminalTab context={context} />,
});

registerWorkbenchTabKind('files', {
  defaultTitle: 'Файлы',
  icon: <FileText className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (_tab, context) => (
    <div className="h-full overflow-hidden">
      <FileTree selectedProject={context.project} onFileOpen={context.onFileOpen} />
    </div>
  ),
});

registerWorkbenchTabKind('stats', {
  defaultTitle: 'Статистика',
  icon: <BarChart3 className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (_tab, context) => (
    <div className="h-full overflow-hidden">
      <ProjectStatsPanel selectedProject={context.project} />
    </div>
  ),
});

registerWorkbenchTabKind('autopilot', {
  defaultTitle: 'Автопилот',
  icon: <Gauge className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  available: (menu) => menu.autopilotAvailable,
  render: (_tab, context) => (
    <div className="h-full overflow-hidden">
      <AutopilotTab projectId={context.project.projectId} />
    </div>
  ),
});

registerWorkbenchTabKind('plugin', {
  defaultTitle: 'Плагин',
  icon: <Puzzle className="h-3.5 w-3.5" aria-hidden />,
  inMenu: true,
  render: (tab, context) =>
    tab.ref ? (
      <div className="h-full overflow-hidden">
        <PluginTabContent pluginName={tab.ref} selectedProject={context.project} selectedSession={context.session} />
      </div>
    ) : (
      <p className="p-6 text-sm text-muted-foreground">Плагин не указан.</p>
    ),
});
