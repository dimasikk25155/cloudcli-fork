import { useState } from 'react';
import { Settings, AlertTriangle, CalendarClock, Timer, Workflow, Send } from 'lucide-react';
import type { TFunction } from 'i18next';
import { IS_PLATFORM } from '../../../../constants/config';
import NightshiftModal from '../../../nightshift/NightshiftModal';
import PanelModal from '../../../panels/PanelModal';
import SchedulesPanel from '../../../schedules/SchedulesPanel';
import PipelinesPanel from '../../../pipelines/PipelinesPanel';
import TelegramSettingsPanel from '../../../telegram/TelegramSettingsPanel';

// Entry points for the three unattended-work features. Labels are Russian in
// place: these panels ship ahead of their translation namespaces.
const FEATURE_PANELS = [
  { key: 'schedules', label: 'Расписания', icon: Timer },
  { key: 'pipelines', label: 'Сценарии', icon: Workflow },
  { key: 'telegram', label: 'Telegram-бот', icon: Send },
] as const;

type FeaturePanelKey = (typeof FEATURE_PANELS)[number]['key'];

type SidebarFooterProps = {
  restartRequired: boolean;
  currentVersion: string;
  onShowSettings: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  restartRequired,
  currentVersion,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const [showNightshift, setShowNightshift] = useState(false);
  const [openPanel, setOpenPanel] = useState<FeaturePanelKey | null>(null);

  return (
    <div className="sidebar-footer flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5 md:px-2 md:py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Settings */}
      <div className="nav-divider" />

      {/* Desktop night-shift runs */}
      <div className="hidden px-2 pt-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => setShowNightshift(true)}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span className="text-sm">{t('nightshift.title')}</span>
        </button>
      </div>

      {/* Desktop unattended-work panels */}
      {FEATURE_PANELS.map(({ key, label, icon: Icon }) => (
        <div key={key} className="hidden px-2 pt-1.5 md:block">
          <button
            className="sidebar-footer-item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={() => setOpenPanel(key)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="text-sm">{label}</span>
          </button>
        </div>
      ))}

      {/* Desktop settings */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Desktop version brand line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 py-2 text-center md:block">
          <span className="text-[10px] text-muted-foreground/40">
            Neo3 Agent System v{currentVersion}
          </span>
        </div>
      )}

      {/* Mobile night-shift runs */}
      <div className="px-3 pt-3 md:hidden">
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={() => setShowNightshift(true)}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-normal text-foreground">{t('nightshift.title')}</span>
        </button>
      </div>

      {/* Mobile unattended-work panels */}
      {FEATURE_PANELS.map(({ key, label, icon: Icon }) => (
        <div key={key} className="px-3 pt-3 md:hidden">
          <button
            className="sidebar-footer-item flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
            onClick={() => setOpenPanel(key)}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-normal text-foreground">{label}</span>
          </button>
        </div>
      ))}

      {/* Mobile settings */}
      <div className="px-3 pb-3 pt-2 md:hidden">
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <Settings className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-normal text-foreground">{t('actions.settings')}</span>
        </button>
      </div>

      {showNightshift && <NightshiftModal onClose={() => setShowNightshift(false)} t={t} />}

      {openPanel === 'schedules' && (
        <PanelModal title="Расписания" icon={Timer} onClose={() => setOpenPanel(null)}>
          <SchedulesPanel />
        </PanelModal>
      )}
      {openPanel === 'pipelines' && (
        <PanelModal title="Сценарии" icon={Workflow} onClose={() => setOpenPanel(null)}>
          <PipelinesPanel />
        </PanelModal>
      )}
      {openPanel === 'telegram' && (
        <PanelModal title="Telegram-бот" icon={Send} onClose={() => setOpenPanel(null)}>
          <TelegramSettingsPanel />
        </PanelModal>
      )}
    </div>
  );
}
