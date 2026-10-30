import { canAccessProject } from '../../../shared/project-access.js';
import { connectedClients, WS_OPEN_STATE } from './websocket-state.service.js';
// The access rule itself lives in `@/shared/project-access` (single source of
// truth). This module only keeps what is websocket-specific: the identity of
// each authenticated socket and the per-socket filter for project broadcasts.
export { canAccessProject, canAccessSession } from '../../../shared/project-access.js';
// Identity belongs to the authenticated socket, never to client message fields.
export const clientIdentities = new WeakMap();
/**
 * The user id of an authenticated socket, in the formats produced by the
 * platform and OSS auth paths: `id`, otherwise `userId` (number or string).
 */
export function readSocketUserId(user) {
    if (!user) {
        return null;
    }
    if (typeof user.id === 'string' || typeof user.id === 'number') {
        return user.id;
    }
    if (typeof user.userId === 'string' || typeof user.userId === 'number') {
        return user.userId;
    }
    return null;
}
export function broadcastProjectEvent(payload, projectId) {
    for (const client of connectedClients) {
        if (client.readyState === WS_OPEN_STATE && canAccessProject(clientIdentities.get(client), projectId)) {
            client.send(payload);
        }
    }
}
//# sourceMappingURL=project-access.service.js.map