import { useTranslation } from 'react-i18next';
import type { MainContentStateViewProps } from '../../types/types';
import HomeLauncher from '../../../home/HomeLauncher';
import MobileMenuButton from './MobileMenuButton';

export default function MainContentStateView({
  mode,
  isMobile,
  onMenuClick,
  projects = [],
  onProjectSelect,
  onShowSettings,
  onToggleStarProject,
}: MainContentStateViewProps) {
  const { t } = useTranslation();

  if (mode === 'empty') {
    return (
      <HomeLauncher
        projects={projects}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        onProjectSelect={onProjectSelect ?? (() => undefined)}
        onShowSettings={() => onShowSettings?.()}
        onToggleStarProject={onToggleStarProject}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-sm sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <div className="mx-auto mb-4 h-10 w-10">
            <div
              className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
              style={{
                animation: 'spin 1s linear infinite',
                WebkitAnimation: 'spin 1s linear infinite',
                MozAnimation: 'spin 1s linear infinite',
              }}
            />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
          <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
        </div>
      </div>
    </div>
  );
}
