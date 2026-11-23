import { useMemo } from 'react';

import { IS_PLATFORM } from '../../constants/config';
import { useModEnabled } from '../../hooks/useModEnabled';
// Not the `../auth` barrel: it pulls in the terminal and its stylesheet,
// which node render tests cannot load.
import { useAuth } from '../auth/context/AuthContext';

import type { ToolPanelAccess } from './toolPanels';

/**
 * Кто этот человек для списка «Инструментов»: владелец установки или нет, и
 * какие встроенные моды у него включены. Те же условия, что стояли в «Меню».
 */
export function useToolPanelAccess(): ToolPanelAccess {
  const { user } = useAuth();
  const isOwner = !IS_PLATFORM && user?.role === 'admin';
  const modDuet = useModEnabled('modDuet');
  const modAgents = useModEnabled('modAgents');
  const modAgentQueue = useModEnabled('modAgentQueue');
  const modKrabikAgent = useModEnabled('modKrabikAgent');

  return useMemo(
    () => ({ isOwner, mods: { modDuet, modAgents, modAgentQueue, modKrabikAgent } }),
    [isOwner, modDuet, modAgents, modAgentQueue, modKrabikAgent],
  );
}
