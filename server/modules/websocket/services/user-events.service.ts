import { clientIdentities, readSocketUserId } from './project-access.service.js';
import { connectedClients, WS_OPEN_STATE } from './websocket-state.service.js';

/** Content-free "your settings changed, re-read them" frame. Not a chat row. */
const UI_PREFERENCES_CHANGED = 'ui_preferences_changed';

/** Content-free "re-read your sidebar groups" frame. Not a chat row. */
const SIDEBAR_GROUPS_CHANGED = 'sidebar_groups_changed';

function sameUser(socketUserId: string | number | null, userId: number): boolean {
  return socketUserId !== null && Number(socketUserId) === userId;
}

/** Sends a frame to every open socket of one user; other users never see it. */
function sendToUser(userId: number, payload: Record<string, unknown>): void {
  const frame = JSON.stringify(payload);
  for (const client of connectedClients) {
    if (client.readyState === WS_OPEN_STATE && sameUser(readSocketUserId(clientIdentities.get(client)), userId)) {
      client.send(frame);
    }
  }
}

/**
 * After `PUT /api/settings/ui-preferences`: the user's other devices re-read
 * their settings, so a mod switched off on the laptop disappears from the
 * phone without a reload.
 */
export function notifyUiPreferencesChanged(userId: number): void {
  sendToUser(userId, { kind: UI_PREFERENCES_CHANGED });
}

/** After any change of sidebar groups or pins: the user's other devices re-read the tree. */
export function notifySidebarGroupsChanged(userId: number): void {
  sendToUser(userId, { kind: SIDEBAR_GROUPS_CHANGED });
}
