/**
 * The page-wide «Рабочий стол» store and its React hooks.
 *
 * `openWorkbenchTab` / `closeWorkbenchTab` work from anywhere (a button in a
 * chat message, a slash command result) — opening a tab also switches the
 * workbench on. `useWorkbenchAccountSync` is mounted once by the main screen.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useWebSocket } from '../../contexts/WebSocketContext';
import type { ServerEvent } from '../../contexts/WebSocketContext';
import type { GatewayEventKind } from '../../types/app';
import { authenticatedFetch } from '../../utils/api';

import { createWorkbenchStore, type WorkbenchLayout, type WorkbenchSessionState } from './workbenchStore';
import type { WorkbenchTab, WorkbenchTabInput } from './workbenchTabs';

const ACCOUNT_SAVE_DELAY_MS = 400;
const UI_PREFERENCES_CHANGED: GatewayEventKind = 'ui_preferences_changed';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// A local change not yet stored in the account: a re-read must not undo it.
let savesInFlight = 0;

function saveLayoutToAccount(json: string): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savesInFlight += 1;
    authenticatedFetch('/api/settings/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify({ workbenchLayout: json }),
    }).catch((error: unknown) => {
      console.warn('Failed to save the workbench layout to the account:', error);
    }).finally(() => {
      savesInFlight -= 1;
    });
  }, ACCOUNT_SAVE_DELAY_MS);
}

export const workbenchStore = createWorkbenchStore({
  storage: typeof window === 'undefined' ? null : window.localStorage,
  saveLayout: saveLayoutToAccount,
});

export function openWorkbenchTab(sessionId: string | null, tab: WorkbenchTabInput): void {
  workbenchStore.openTab(sessionId, tab);
}

/** «+»: a new «Новая вкладка»; returns its id. */
export function openNewWorkbenchTab(sessionId: string | null): string {
  return workbenchStore.openNewTab(sessionId);
}

/** What was picked in «Новая вкладка» takes its place (an already open tab is shown instead). */
export function replaceWorkbenchTab(sessionId: string | null, tabId: string, tab: WorkbenchTabInput, options?: { keepActive?: boolean }): void {
  workbenchStore.replaceTab(sessionId, tabId, tab, options);
}

export function closeWorkbenchTab(sessionId: string | null, tabId: string): void {
  workbenchStore.closeTab(sessionId, tabId);
}

export type UseWorkbench = {
  enabled: boolean;
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  ratio: number;
  /** Grows on every opened tab (the phone opens the canvas over the chat). */
  openSeq: number;
  setEnabled: (enabled: boolean) => void;
  setActive: (tabId: string) => void;
  setRatio: (ratio: number) => void;
};

const subscribe = (listener: () => void) => workbenchStore.subscribe(listener);
const readLayout = (): WorkbenchLayout => workbenchStore.getLayout();
const readOpenSeq = (): number => workbenchStore.getOpenSeq();

export function useWorkbench(sessionId: string | null): UseWorkbench {
  const layout = useSyncExternalStore(subscribe, readLayout, readLayout);
  const readSession = useCallback((): WorkbenchSessionState => workbenchStore.getSession(sessionId), [sessionId]);
  const session = useSyncExternalStore(subscribe, readSession, readSession);
  const openSeq = useSyncExternalStore(subscribe, readOpenSeq, readOpenSeq);
  const setEnabled = useCallback((enabled: boolean) => workbenchStore.setEnabled(enabled), []);
  const setActive = useCallback((tabId: string) => workbenchStore.setActive(sessionId, tabId), [sessionId]);
  const setRatio = useCallback((ratio: number) => workbenchStore.setRatio(ratio), []);
  return {
    enabled: layout.enabled,
    ratio: layout.ratio,
    openSeq,
    tabs: session.tabs,
    activeTabId: session.activeTabId,
    setEnabled,
    setActive,
    setRatio,
  };
}

async function pullAccountLayout(): Promise<void> {
  if (saveTimer || savesInFlight > 0) return;
  try {
    const response = await authenticatedFetch('/api/settings/ui-preferences');
    if (!response.ok) return;
    const data = (await response.json()) as { preferences?: Record<string, unknown> } | null;
    if (saveTimer || savesInFlight > 0) return;
    workbenchStore.applyAccountLayout(data?.preferences?.workbenchLayout);
  } catch {
    // Offline: this browser's copy stays.
  }
}

/** Mount once: the account layout on load, after a save on another device, on return to the tab. */
export function useWorkbenchAccountSync(): void {
  const { subscribe: subscribeSocket } = useWebSocket();
  useEffect(() => {
    void pullAccountLayout();
    const unsubscribe = subscribeSocket((event: ServerEvent) => {
      if (event.kind === UI_PREFERENCES_CHANGED || event.kind === 'websocket_reconnected') void pullAccountLayout();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullAccountLayout();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [subscribeSocket]);
}
