export const OPEN_HUB_PANEL_EVENT = 'neo3:open-hub-panel';

export type HubPanelKey =
  | 'consigliere'
  | 'mazda'
  | 'schedules'
  | 'pipelines'
  | 'governance'
  | 'server'
  | 'nightshift'
  | 'settings';

export function requestHubPanel(key: HubPanelKey) {
  window.dispatchEvent(new CustomEvent(OPEN_HUB_PANEL_EVENT, { detail: { key } }));
}
