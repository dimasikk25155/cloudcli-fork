import { sidebarGroupsDb } from '@/modules/database/index.js';
import { canAccessProject, canAccessSession } from '@/shared/project-access.js';

import { createSidebarGroupsService, type SidebarGroupsService } from './sidebar-groups.service.js';

let service: SidebarGroupsService | undefined;

/** Production wiring, built on first use (after the database is open). */
export function getSidebarGroupsService(): SidebarGroupsService {
  return service ??= createSidebarGroupsService({
    repo: sidebarGroupsDb,
    canAccessProject: (userId, projectId) => canAccessProject({ id: userId }, projectId),
    canAccessSession: (userId, sessionId) => canAccessSession({ id: userId }, sessionId),
    notify: (userId) => {
      // Lazy import: the websocket module pulls in half of the server.
      void import('@/modules/websocket/index.js')
        .then((ws) => ws.notifySidebarGroupsChanged(userId))
        .catch(() => undefined);
    },
  });
}
