import AgentWorkspacePanel from '../../../agent-workspace/AgentWorkspacePanel';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Timer,
  Workflow,
  Server,
  ShieldCheck,
  ChevronDown,
  LayoutGrid,
  Wallet,
  Car,
  Shell,
  Music2,
  Users,
  ListChecks,
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
import { usePlannerAttention } from '../../../consigliere/usePlannerAttention';
import MazdaCard from '../../../hub/MazdaCard';
import { OPEN_HUB_PANEL_EVENT, type HubPanelKey } from '../../../hub/hubPanels';
import { useAuth } from '../../../auth';
import AgentsPanel from '../../../agents/AgentsPanel';
import AgentQueuePanel from '../../../agent-queue/AgentQueuePanel';
import KrabikPanel from '../../../krabik/KrabikPanel';
import DuetPanel from '../../../duet/DuetPanel';
import { useModEnabled } from '../../../../hooks/useModEnabled';

import SidebarMenuItems, { type SidebarMenuItem } from './SidebarMenuItems';
import { shouldCollapseMenu } from './sidebarMenuState';

// Entry points for the unattended-work features. Labels are Russian in place:
// these panels ship ahead of their translation namespaces. The Telegram bot
// setup used to sit here too — it moved into Settings (a one-off setup does
// not belong next to everyday actions). Icons: own drawn set, `menu-icons/`.
const HUB_PANELS = [
  { key: 'consigliere', label: 'Канцелярия' },
  { key: 'mazda', label: 'Мазда' },
] as const;

const FEATURE_PANELS = [
  { key: 'agent-workspace', label: 'Рабочее пространство' },
  { key: 'schedules', label: 'Расписания' },
  { key: 'pipelines', label: 'Сценарии' },
  // Что происходило без тебя и во сколько это обошлось. Доступна всем, но
  // показывает только свои прогоны — на общем инстансе арендатор не должен
  // видеть чужие траты.
  { key: 'governance', label: 'Аудит и деньги' },
] as const;

// The server panel can stop and start system services, so it is owner-only —
// tenants of a shared instance must not even see the entry point.
const SERVER_PANEL = { key: 'server', label: 'Сервер' } as const;

// «Агент крабик» — агент владельца на VPS (мод modKrabikAgent), тоже только админу.
const KRABIK_PANEL = { key: 'krabik', label: 'Агент крабик' } as const;

// «Дуэт» — напарник по ботам и сервисам (мод modDuet), только админу.
const DUET_PANEL = { key: 'duet', label: 'Дуэт' } as const;

// «Агенты» — именованные помощники с ролью и памятью (мод modAgents), только админу.
const AGENTS_PANEL = { key: 'agents', label: 'Агенты' } as const;

// «Конвейер» — очередь пунктов агенту с вердиктами (мод modAgentQueue, требует modAgents), только админу.
const QUEUE_PANEL = { key: 'queue', label: 'Конвейер' } as const;

type FeaturePanelKey =
  | (typeof HUB_PANELS)[number]['key']
  | (typeof FEATURE_PANELS)[number]['key']
  | typeof SERVER_PANEL.key
  | typeof KRABIK_PANEL.key
  | typeof DUET_PANEL.key
  | typeof AGENTS_PANEL.key
  | typeof QUEUE_PANEL.key;

type SidebarFooterProps = {
  restartRequired: boolean;
  currentVersion: string;
  onShowSettings: () => void;
  /** Phone drawer shown? `undefined` on a computer (see sidebarMenuState). */
  drawerOpen?: boolean;
  t: TFunction;
};

export default function SidebarFooter({
  restartRequired,
  currentVersion,
  onShowSettings,
  drawerOpen,
  t,
}: SidebarFooterProps) {
  const [showNightshift, setShowNightshift] = useState(false);
  const [openPanel, setOpenPanel] = useState<FeaturePanelKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The phone drawer is hidden, not unmounted: fold «Меню» on each opening.
  // Adjusted during render (not in an effect) so the grid never flashes open.
  const [seenDrawerOpen, setSeenDrawerOpen] = useState(drawerOpen);
  if (seenDrawerOpen !== drawerOpen) {
    setSeenDrawerOpen(drawerOpen);
    if (shouldCollapseMenu(seenDrawerOpen, drawerOpen)) setMenuOpen(false);
  }
  const { items: attention } = usePlannerAttention();
  const overdueCount = attention.length;
  const { user } = useAuth();
  const isOwner = !IS_PLATFORM && user?.role === 'admin';
  const krabikOn = useModEnabled('modKrabikAgent');
  const duetOn = useModEnabled('modDuet');
  const agentsOn = useModEnabled('modAgents');
  // «Конвейер» требует «Агентов»: без них пункт скрыт, как и на сервере (MOD_OFF).
  const queueOn = useModEnabled('modAgentQueue') && agentsOn;
  const navigate = useNavigate();
  const panels = isOwner
    ? [...HUB_PANELS, ...FEATURE_PANELS, SERVER_PANEL, ...(duetOn ? [DUET_PANEL] : []), ...(agentsOn ? [AGENTS_PANEL] : []), ...(queueOn ? [QUEUE_PANEL] : []), ...(krabikOn ? [KRABIK_PANEL] : [])]
    : [...HUB_PANELS, ...FEATURE_PANELS];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('panel');
    if (fromQuery === 'agent-workspace' || fromQuery === 'consigliere' || fromQuery === 'mazda' || fromQuery === 'schedules'
      || fromQuery === 'pipelines' || fromQuery === 'governance' || fromQuery === 'server'
      || fromQuery === 'krabik' || fromQuery === 'duet' || fromQuery === 'agents' || fromQuery === 'queue') {
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
        panel === 'server' || panel === 'consigliere' || panel === 'krabik' || panel === 'duet' || panel === 'agents'
        || panel === 'queue'
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

  useEffect(() => {
    const close = () => setOpenPanel(null);
    window.addEventListener('neo3:workspace-close', close);
    return () => window.removeEventListener('neo3:workspace-close', close);
  }, []);

  // One list, two shapes: rows on a computer, a 4-across grid on a phone.
  const actions: SidebarMenuItem[] = [
    { key: 'nightshift', label: t('nightshift.title'), onClick: () => setShowNightshift(true) },
    ...panels.map(({ key, label }) => ({ key, label, onClick: () => setOpenPanel(key) })),
    { key: 'settings', label: t('actions.settings'), onClick: onShowSettings },
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

      {/* «Меню» on every width, collapsed on mount and on every phone-drawer opening: permanent
          rows pushed the session list up on a computer, and on a phone a row
          of 13 tiny tiles cut every label to «З…». Open: rows on a computer,
          big tiles 4 across on a phone. */}
      <div className="px-2 pb-3 pt-1.5 md:pb-1.5">
        <button
          type="button"
          className="relative flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:py-1.5"
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
          <>
            <div className="hidden md:block">
              <SidebarMenuItems items={actions} variant="list" overdueCount={overdueCount} />
            </div>
            <div className="max-h-[60vh] overflow-y-auto md:hidden">
              <SidebarMenuItems items={actions} variant="grid" overdueCount={overdueCount} />
            </div>
          </>
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

      {showNightshift && <NightshiftModal onClose={() => setShowNightshift(false)} t={t} />}

      {openPanel === 'agent-workspace' && <PanelModal title="Рабочее пространство" icon={LayoutGrid} onClose={() => setOpenPanel(null)} contentClassName="md:max-w-4xl"><AgentWorkspacePanel onClose={() => setOpenPanel(null)} /></PanelModal>}
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
      {openPanel === 'duet' && isOwner && duetOn && (
        <PanelModal title="Дуэт" icon={Music2} onClose={() => setOpenPanel(null)} contentClassName="md:max-w-3xl">
          <DuetPanel />
        </PanelModal>
      )}
      {openPanel === 'agents' && isOwner && agentsOn && (
        <PanelModal title="Агенты" icon={Users} onClose={() => setOpenPanel(null)} contentClassName="md:max-w-3xl">
          {/* Созданный чат открываем сразу, панель при этом уходит с экрана. */}
          <AgentsPanel onOpenChat={(sessionId) => { setOpenPanel(null); navigate(`/session/${sessionId}`); }} />
        </PanelModal>
      )}
      {openPanel === 'queue' && isOwner && queueOn && (
        <PanelModal title="Конвейер" icon={ListChecks} onClose={() => setOpenPanel(null)} contentClassName="md:max-w-3xl">
          {/* Чат исполнителя открываем сразу, панель при этом уходит с экрана. */}
          <AgentQueuePanel onOpenChat={(sessionId) => { setOpenPanel(null); navigate(`/session/${sessionId}`); }} />
        </PanelModal>
      )}
      {openPanel === 'krabik' && isOwner && krabikOn && (
        <PanelModal title="Агент крабик" icon={Shell} onClose={() => setOpenPanel(null)} contentClassName="md:max-w-3xl">
          <KrabikPanel />
        </PanelModal>
      )}
    </div>
  );
}
