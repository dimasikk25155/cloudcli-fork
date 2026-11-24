import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Car,
  LayoutGrid,
  ListChecks,
  Music2,
  Server,
  Shell,
  ShieldCheck,
  Timer,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';

import AgentQueuePanel from '../agent-queue/AgentQueuePanel';
import AgentWorkspacePanel from '../agent-workspace/AgentWorkspacePanel';
import AgentsPanel from '../agents/AgentsPanel';
import ConsiglierePlanner from '../consigliere/ConsiglierePlanner';
import DuetPanel from '../duet/DuetPanel';
import GovernancePanel from '../governance/GovernancePanel';
import { OPEN_HUB_PANEL_EVENT, type HubPanelKey } from '../hub/hubPanels';
import MazdaCard from '../hub/MazdaCard';
import KrabikPanel from '../krabik/KrabikPanel';
import NightshiftModal from '../nightshift/NightshiftModal';
import PanelModal from '../panels/PanelModal';
import PipelinesPanel from '../pipelines/PipelinesPanel';
import SchedulesPanel from '../schedules/SchedulesPanel';
import ServerPanel from '../server/ServerPanel';

import {
  canOpenToolPanel,
  isToolPanelKey,
  toolPanelFor,
  toolPanelFromNavigateMessage,
  toolPanelFromQuery,
  type ToolPanelKey,
} from './toolPanels';
import { useToolPanelAccess } from './useToolPanelAccess';

type ToolPanelsHostProps = {
  /** `requestHubPanel('settings')` — открыть настройки. */
  onOpenSettings: () => void;
};

/**
 * Открывает экраны бывшего «Меню». Смонтирован в оболочке приложения всегда —
 * раньше состояние и слушатели жили в подвале шторки и пропадали вместе с ним
 * (свёрнутая шторка на компьютере). Три входа, один набор ключей:
 * ссылка `?panel=<ключ>`, нажатое уведомление (`notification:navigate`) и
 * `requestHubPanel(key)`. Экран, которого у человека нет в «Инструментах»
 * (не владелец, выключен мод), не открывается ни одним из них.
 */
export default function ToolPanelsHost({ onOpenSettings }: ToolPanelsHostProps) {
  const { t } = useTranslation('sidebar');
  const navigate = useNavigate();
  const access = useToolPanelAccess();
  const [openPanel, setOpenPanel] = useState<ToolPanelKey | null>(null);
  const close = useCallback(() => setOpenPanel(null), []);

  useEffect(() => {
    const fromQuery = toolPanelFromQuery(window.location.search);
    if (fromQuery) setOpenPanel(fromQuery);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }
    const onMessage = (event: MessageEvent) => {
      const panel = toolPanelFromNavigateMessage(event.data);
      if (panel) setOpenPanel(panel);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const key = (event as CustomEvent<{ key?: HubPanelKey }>).detail?.key;
      if (key === 'settings') {
        onOpenSettings();
        return;
      }
      if (isToolPanelKey(key)) setOpenPanel(key);
    };
    window.addEventListener(OPEN_HUB_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HUB_PANEL_EVENT, onOpen);
  }, [onOpenSettings]);

  useEffect(() => {
    window.addEventListener('neo3:workspace-close', close);
    return () => window.removeEventListener('neo3:workspace-close', close);
  }, [close]);

  if (!openPanel || !canOpenToolPanel(openPanel, access)) return null;

  // Созданный чат открываем сразу, экран при этом уходит.
  const openChat = (sessionId: string) => {
    close();
    navigate(`/session/${sessionId}`);
  };
  const title = toolPanelFor(openPanel).label;

  switch (openPanel) {
    case 'nightshift':
      return <NightshiftModal onClose={close} t={t} />;
    case 'agent-workspace':
      return (
        <PanelModal title={title} icon={LayoutGrid} onClose={close} contentClassName="md:max-w-4xl">
          <AgentWorkspacePanel onClose={close} />
        </PanelModal>
      );
    case 'consigliere':
      return <PanelModal title={title} icon={Wallet} onClose={close}><ConsiglierePlanner /></PanelModal>;
    case 'mazda':
      return <PanelModal title={title} icon={Car} onClose={close}><MazdaCard /></PanelModal>;
    case 'schedules':
      return <PanelModal title={title} icon={Timer} onClose={close}><SchedulesPanel /></PanelModal>;
    case 'pipelines':
      return <PanelModal title={title} icon={Workflow} onClose={close}><PipelinesPanel /></PanelModal>;
    case 'governance':
      return <PanelModal title={title} icon={ShieldCheck} onClose={close}><GovernancePanel /></PanelModal>;
    case 'server':
      return (
        <PanelModal title={title} icon={Server} onClose={close}>
          {/* Кнопка «Починить» уводит в чат — экран при этом должен уйти. */}
          <ServerPanel onRequestClose={close} />
        </PanelModal>
      );
    case 'duet':
      return (
        <PanelModal title={title} icon={Music2} onClose={close} contentClassName="md:max-w-3xl">
          <DuetPanel />
        </PanelModal>
      );
    case 'agents':
      return (
        <PanelModal title={title} icon={Users} onClose={close} contentClassName="md:max-w-3xl">
          <AgentsPanel onOpenChat={openChat} />
        </PanelModal>
      );
    case 'queue':
      return (
        <PanelModal title={title} icon={ListChecks} onClose={close} contentClassName="md:max-w-3xl">
          <AgentQueuePanel onOpenChat={openChat} />
        </PanelModal>
      );
    case 'krabik':
      return (
        <PanelModal title={title} icon={Shell} onClose={close} contentClassName="md:max-w-3xl">
          <KrabikPanel />
        </PanelModal>
      );
    default: {
      const unknown: never = openPanel;
      return unknown;
    }
  }
}
