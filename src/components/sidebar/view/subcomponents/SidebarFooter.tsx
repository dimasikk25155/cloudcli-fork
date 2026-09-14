import { useEffect, useState } from 'react';
import {
  Settings,
  AlertTriangle,
  CalendarClock,
  Timer,
  Workflow,
  Server,
  ShieldCheck,
  ChevronDown,
  LayoutGrid,
  Wallet,
  Car,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { IS_PLATFORM } from '../../../../constants/config';
import NightshiftModal from '../../../nightshift/NightshiftModal';
import PanelModal from '../../../panels/PanelModal';
import SchedulesPanel from '../../../schedules/SchedulesPanel';
import PipelinesPanel from '../../../pipelines/PipelinesPanel';
import ServerPanel from '../../../server/ServerPanel';
import GovernancePanel from '../../../governance/GovernancePanel';
import ConsiglierePlanner from '../../../consigliere/ConsiglierePlanner';
import { CountDot } from '../../../consigliere/PlannerAttentionButton';
import { usePlannerAttention } from '../../../consigliere/usePlannerAttention';
import MazdaCard from '../../../hub/MazdaCard';
import { OPEN_HUB_PANEL_EVENT, type HubPanelKey } from '../../../hub/hubPanels';
import AppIcon from '../../../app-icon/AppIcon';
import type { ProjectGlyph } from '../../../app-icon/projectIconSpec';
import { useAuth } from '../../../auth';

// Entry points for the unattended-work features. Labels are Russian in place:
// these panels ship ahead of their translation namespaces. The Telegram bot
// setup used to sit here too — it moved into Settings (a one-off setup does
// not belong next to everyday actions).
// shortLabel is what fits under an icon in the mobile row (~54px wide).
const HUB_PANELS = [
  { key: 'consigliere', label: 'Канцелярия', shortLabel: 'Дела', icon: Wallet },
  { key: 'mazda', label: 'Мазда', shortLabel: 'Мазда', icon: Car },
] as const;

const FEATURE_PANELS = [
  { key: 'schedules', label: 'Расписания', shortLabel: 'График', icon: Timer },
  { key: 'pipelines', label: 'Сценарии', shortLabel: 'Сцены', icon: Workflow },
  // Что происходило без тебя и во сколько это обошлось. Доступна всем, но
  // показывает только свои прогоны — на общем инстансе арендатор не должен
  // видеть чужие траты.
  { key: 'governance', label: 'Аудит и деньги', shortLabel: 'Деньги', icon: ShieldCheck },
] as const;

// The server panel can stop and start system services, so it is owner-only —
// tenants of a shared instance must not even see the entry point.
const SERVER_PANEL = { key: 'server', label: 'Сервер', shortLabel: 'Сервер', icon: Server } as const;

const APP_ICON: Record<string, { background: string; foreground: string; glyph: ProjectGlyph }> = {
  nightshift: { background: '#1F4E5A', foreground: '#E7F4F2', glyph: 'tasks' },
  consigliere: { background: '#5C3A21', foreground: '#F3D2A8', glyph: 'wallet' },
  mazda: { background: '#4A5560', foreground: '#F4F1EA', glyph: 'car' },
  schedules: { background: '#1F4E5A', foreground: '#E7F4F2', glyph: 'calendar' },
  pipelines: { background: '#3E2A78', foreground: '#F1ECFF', glyph: 'workflow' },
  governance: { background: '#14532D', foreground: '#DCFCE7', glyph: 'shield' },
  server: { background: '#1C3A70', foreground: '#E8F0FF', glyph: 'server' },
  settings: { background: '#3A3A3A', foreground: '#F3F3F0', glyph: 'settings' },
};

type FeaturePanelKey =
  | (typeof HUB_PANELS)[number]['key']
  | (typeof FEATURE_PANELS)[number]['key']
  | typeof SERVER_PANEL.key;

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
  const { items: attention } = usePlannerAttention();
  const overdueCount = attention.length;
  const { user } = useAuth();
  const panels = !IS_PLATFORM && user?.role === 'admin'
    ? [...HUB_PANELS, ...FEATURE_PANELS, SERVER_PANEL]
    : [...HUB_PANELS, ...FEATURE_PANELS];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('panel');
    if (fromQuery === 'consigliere' || fromQuery === 'mazda' || fromQuery === 'schedules'
      || fromQuery === 'pipelines' || fromQuery === 'governance' || fromQuery === 'server') {
      setOpenPanel(fromQuery);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }
    const onMessage = (event: MessageEvent) => {
      const panel = event.data?.panel;
      if (event.data?.type === 'notification:navigate' && (
        panel === 'server' || panel === 'consigliere'
      )) {
        setOpenPanel(panel);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const key = (event as CustomEvent<{ key?: HubPanelKey }>).detail?.key;
      if (!key) return;
      if (key === 'settings') {
        onShowSettings();
        return;
      }
      if (key === 'nightshift') {
        setShowNightshift(true);
        return;
      }
      setOpenPanel(key as FeaturePanelKey);
    };
    window.addEventListener(OPEN_HUB_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HUB_PANEL_EVENT, onOpen);
  }, [onShowSettings]);

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
          className="relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-sm">Меню</span>
          {overdueCount > 0 && !menuOpen && (
            <span className="mr-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
              {overdueCount > 9 ? '9+' : overdueCount}
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {menuOpen && (
          <div className="mt-1 space-y-1">
            {actions.map(({ key, label, icon: Icon, onClick }) => {
              const app = APP_ICON[key];
              return (
              <button
                key={key}
                className="sidebar-footer-item flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={onClick}
              >
                <span className="relative">
                  {app ? (
                    <AppIcon
                      background={app.background}
                      foreground={app.foreground}
                      glyph={app.glyph}
                      letter={label[0]}
                      size="sm"
                    />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {key === 'consigliere' && <CountDot count={overdueCount} />}
                </span>
                <span className="text-sm">{label}</span>
              </button>
              );
            })}
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
        {actions.map(({ key, label, shortLabel, icon: Icon, onClick }) => {
          const app = APP_ICON[key];
          return (
          <button
            key={key}
            className="sidebar-footer-item flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 transition-all hover:bg-muted/40 active:scale-[0.94]"
            onClick={onClick}
            title={label}
            aria-label={label}
          >
            <span className="relative">
              {app ? (
                <AppIcon
                  background={app.background}
                  foreground={app.foreground}
                  glyph={app.glyph}
                  letter={label[0]}
                  size="sm"
                />
              ) : (
                <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              )}
              {key === 'consigliere' && <CountDot count={overdueCount} />}
            </span>
            <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
              {shortLabel}
            </span>
          </button>
          );
        })}
      </div>

      {showNightshift && <NightshiftModal onClose={() => setShowNightshift(false)} t={t} />}

      {openPanel === 'consigliere' && (
        <PanelModal title="Канцелярия" icon={Wallet} onClose={() => setOpenPanel(null)}>
          <ConsiglierePlanner />
        </PanelModal>
      )}
      {openPanel === 'mazda' && (
        <PanelModal title="Мазда" icon={Car} onClose={() => setOpenPanel(null)}>
          <MazdaCard />
        </PanelModal>
      )}
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
      {openPanel === 'governance' && (
        <PanelModal title="Аудит и деньги" icon={ShieldCheck} onClose={() => setOpenPanel(null)}>
          <GovernancePanel />
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
