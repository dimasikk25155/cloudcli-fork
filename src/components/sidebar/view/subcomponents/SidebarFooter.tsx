import { useState } from 'react';
import {
  Settings,
  AlertTriangle,
  CalendarClock,
  Timer,
  Workflow,
  Server,
  ChevronDown,
  LayoutGrid,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { IS_PLATFORM } from '../../../../constants/config';
import NightshiftModal from '../../../nightshift/NightshiftModal';
import PanelModal from '../../../panels/PanelModal';
import SchedulesPanel from '../../../schedules/SchedulesPanel';
import PipelinesPanel from '../../../pipelines/PipelinesPanel';
import ServerPanel from '../../../server/ServerPanel';
import { useAuth } from '../../../auth';

// Entry points for the unattended-work features. Labels are Russian in place:
// these panels ship ahead of their translation namespaces. The Telegram bot
// setup used to sit here too — it moved into Settings (a one-off setup does
// not belong next to everyday actions).
// shortLabel is what fits under an icon in the mobile row (~54px wide).
const FEATURE_PANELS = [
  { key: 'schedules', label: 'Расписания', shortLabel: 'График', icon: Timer },
  { key: 'pipelines', label: 'Сценарии', shortLabel: 'Сцены', icon: Workflow },
] as const;

// The server panel can stop and start system services, so it is owner-only —
// tenants of a shared instance must not even see the entry point.
const SERVER_PANEL = { key: 'server', label: 'Сервер', shortLabel: 'Сервер', icon: Server } as const;

type FeaturePanelKey = (typeof FEATURE_PANELS)[number]['key'] | typeof SERVER_PANEL.key;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const { user } = useAuth();
  const panels = !IS_PLATFORM && user?.role === 'admin' ? [...FEATURE_PANELS, SERVER_PANEL] : FEATURE_PANELS;

  // One list, two shapes: the mobile icon row uses shortLabel, the desktop
  // menu uses the full label.
  const actions = [
    {
      key: 'nightshift',
      label: t('nightshift.title'),
      shortLabel: 'Задачи',
      icon: CalendarClock,
      onClick: () => setShowNightshift(true),
    },
    ...panels.map(({ key, label, shortLabel, icon }) => ({
      key,
      label,
      shortLabel,
      icon,
      onClick: () => setOpenPanel(key),
    })),
    {
      key: 'settings',
      label: t('actions.settings'),
      shortLabel: 'Настройки',
      icon: Settings,
      onClick: onShowSettings,
    },
  ];

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

      {/* Desktop: the same fold as mobile — five permanent rows pushed the
          session list up the sidebar. Collapsed on every mount by design. */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-sm">Меню</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {menuOpen && (
          <div className="mt-1 space-y-1">
            {actions.map(({ key, label, icon: Icon, onClick }) => (
              <button
                key={key}
                className="sidebar-footer-item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={onClick}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="text-sm">{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop version brand line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 py-2 text-center md:block">
          <span className="text-[10px] text-muted-foreground/40">
            Neo3 Agent System v{currentVersion}
          </span>
        </div>
      )}

      {/* Mobile: one icon row instead of full-width buttons — on a phone they
          ate a third of the screen while the session list scrolled. Labels sit
          under the icons so the row stays readable without a spoiler. */}
      <div className="flex items-stretch gap-1.5 px-3 pb-3 pt-2 md:hidden">
        {actions.map(({ key, label, shortLabel, icon: Icon, onClick }) => (
          <button
            key={key}
            className="sidebar-footer-item flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl bg-muted/40 px-0.5 py-2 transition-all hover:bg-muted/60 active:scale-[0.94]"
            onClick={onClick}
            title={label}
            aria-label={label}
          >
            <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
            <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
              {shortLabel}
            </span>
          </button>
        ))}
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
      {openPanel === 'server' && (
        <PanelModal title="Сервер" icon={Server} onClose={() => setOpenPanel(null)}>
          {/* Кнопка «Починить» уводит в чат — панель при этом должна уйти с экрана. */}
          <ServerPanel onRequestClose={() => setOpenPanel(null)} />
        </PanelModal>
      )}
    </div>
  );
}
