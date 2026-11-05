import { useEffect } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { SafariLiveView } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';
import { openWorkbenchTab } from '../workbench/useWorkbench';

import {
  BROWSER_TAB_TITLE,
  markSafariAutoOpened,
  safariBindingKey,
  shouldAutoOpenSafari,
  wasSafariAutoOpened,
} from './safariLiveModel';

type AutoOpenOptions = { isMobile: boolean; workbenchOn: boolean; modOn: boolean; isAdmin: boolean };

/**
 * Агент открыл страницу (`browser.open`) → сервер шлёт `safari_live_changed` этого чата →
 * вкладка «Браузер» встаёт справа один раз на привязку (на телефоне не встаёт).
 */
export function useSafariLiveAutoOpen(sessionId: string | null, options: AutoOpenOptions): void {
  const { subscribe } = useWebSocket();
  const { isMobile, workbenchOn, modOn, isAdmin } = options;

  useEffect(() => {
    if (!sessionId || isMobile || !workbenchOn || !modOn || !isAdmin) return undefined;
    let cancelled = false;
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind !== 'safari_live_changed' || event.sessionId !== sessionId) return;
      void (async () => {
        try {
          const response = await authenticatedFetch(`/api/safari-live/sessions/${encodeURIComponent(sessionId)}`);
          if (!response.ok || cancelled) return;
          const payload = (await response.json().catch(() => null)) as { data?: SafariLiveView } | null;
          const binding = payload?.data?.binding ?? null;
          const key = binding ? safariBindingKey(sessionId, binding) : null;
          const open = shouldAutoOpenSafari({
            isMobile,
            workbenchOn,
            modOn,
            isAdmin,
            bindingKey: key,
            alreadyOpened: key ? wasSafariAutoOpened(key) : false,
          });
          if (!open || !key || cancelled) return;
          markSafariAutoOpened(key);
          openWorkbenchTab(sessionId, { kind: 'safari', title: BROWSER_TAB_TITLE });
        } catch {
          // Сеть моргнула — вкладку можно открыть из «+».
        }
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionId, isMobile, workbenchOn, modOn, isAdmin, subscribe]);
}
