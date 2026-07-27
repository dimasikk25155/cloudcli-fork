import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { localizePluginName } from '../../../plugins/utils/pluginDisplayName';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Large centered treatment for the desktop header. */
  centered?: boolean;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  centered = false,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const activePlugin = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))
    : undefined;
  const pluginDisplayName = activePlugin
    ? localizePluginName(activePlugin.name, activePlugin.displayName, t)
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);

  const title =
    activeTab === 'chat' && selectedSession
      ? getSessionTitle(selectedSession)
      : activeTab === 'chat' && !selectedSession
        ? t('mainContent.newSession')
        : getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName);
  const subtitle = selectedProject.displayName;

  if (centered) {
    // Big, unmistakable "you are here" header for desktop.
    return (
      <div className="flex items-center justify-center gap-2">
        {showSessionIcon && (
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
            <SessionProviderLogo provider={selectedSession?.__provider} className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 text-center">
          <h2
            title={title}
            className="truncate text-lg font-bold leading-tight tracking-tight text-foreground sm:text-xl"
          >
            {title}
          </h2>
          <div className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</div>
        </div>
      </div>
    );
  }

  // Compact left-aligned treatment (mobile / fallback).
  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h2 title={title} className="truncate text-sm font-semibold leading-tight text-foreground">
          {title}
        </h2>
        <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}
