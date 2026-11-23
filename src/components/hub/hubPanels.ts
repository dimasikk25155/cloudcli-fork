import type { ToolPanelKey } from '../tools/toolPanels';

export const OPEN_HUB_PANEL_EVENT = 'neo3:open-hub-panel';

/**
 * Что можно попросить открыть из любого места приложения: любой из двенадцати
 * экранов «Инструментов» или настройки. Слушает `ToolPanelsHost` — он
 * смонтирован всегда, в том числе при свёрнутой шторке.
 */
export type HubPanelKey = ToolPanelKey | 'settings';

export function requestHubPanel(key: HubPanelKey) {
  window.dispatchEvent(new CustomEvent(OPEN_HUB_PANEL_EVENT, { detail: { key } }));
}
