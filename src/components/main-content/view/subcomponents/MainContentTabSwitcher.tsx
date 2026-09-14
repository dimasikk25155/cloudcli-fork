import { useState } from 'react';
import { Type } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, PillBar, Pill } from '../../../../shared/view/ui';
import type { AppTab } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { useAuth } from '../../../auth/context/AuthContext';
import PluginIcon from '../../../plugins/view/PluginIcon';
import { localizePluginName } from '../../../plugins/utils/pluginDisplayName';
import {
  COMPACT_TAB_LABELS_KEY,
  assembleMainTabs,
  readCompactTabLabels,
  tabShowsLabel,
} from './mainContentTabs';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowBrowserTab: boolean;
  shouldShowAutopilotTab: boolean;
};

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
  shouldShowBrowserTab,
  shouldShowAutopilotTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const { terminalDisabled } = useAuth();
  const [compactLabels, setCompactLabels] = useState(readCompactTabLabels);

  // Git и Browser табы скрыты по просьбе — оставлены только Chat/Shell/Files.
  void shouldShowBrowserTab;

  const tabs = assembleMainTabs({
    terminalDisabled,
    shouldShowAutopilotTab,
    plugins,
    localize: (name, displayName) => localizePluginName(name, displayName, t),
  });

  const toggleCompact = () => {
    setCompactLabels((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COMPACT_TAB_LABELS_KEY, String(next));
      } catch {
        // Private mode — the choice still applies for this visit.
      }
      return next;
    });
  };

  const toggleLabel = compactLabels
    ? t('tabs.showLabels', 'Показать подписи')
    : t('tabs.hideLabels', 'Скрыть подписи');

  return (
    <PillBar>
      <Tooltip content={toggleLabel} position="bottom">
        <button
          type="button"
          onClick={toggleCompact}
          aria-pressed={compactLabels}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
        >
          <Type className="h-3.5 w-3.5" strokeWidth={compactLabels ? 1.8 : 2.2} />
        </button>
      </Tooltip>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const displayLabel = tab.kind === 'builtin' ? t(tab.labelKey) : tab.label;
        const showLabel = tabShowsLabel(tab, compactLabels);
        const isAutopilot = tab.id === 'autopilot';

        return (
          <Tooltip key={tab.id} content={displayLabel} position="bottom">
            <Pill
              isActive={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={isAutopilot ? 'px-3 py-[5px]' : 'px-2.5 py-[5px]'}
            >
              {tab.kind === 'builtin' ? (
                <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              ) : (
                <PluginIcon
                  pluginName={tab.pluginName}
                  iconFile={tab.iconFile}
                  className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                />
              )}
              {showLabel && (
                <span className={compactLabels || isAutopilot ? 'inline' : 'hidden lg:inline'}>
                  {displayLabel}
                </span>
              )}
            </Pill>
          </Tooltip>
        );
      })}
    </PillBar>
  );
}
