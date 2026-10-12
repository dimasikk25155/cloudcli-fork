import { projectsDb, sessionsDb, userDb, userProjectAccessDb } from '@/modules/database/index.js';
import type { AuthenticatedWebSocketUser, RealtimeClientConnection } from '@/shared/types.js';
import { connectedClients, WS_OPEN_STATE } from './websocket-state.service.js';

// Identity belongs to the authenticated socket, never to client message fields.
export const clientIdentities = new WeakMap<RealtimeClientConnection, AuthenticatedWebSocketUser>();

export function canAccessProject(user: AuthenticatedWebSocketUser | undefined, projectId: string | null): boolean {
  const id = Number(user?.id ?? user?.userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const currentUser = userDb.getUserById(id);
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  return Boolean(projectId && userProjectAccessDb.getAccessibleProjectIds(id).includes(projectId));
}

export function canAccessSession(user: AuthenticatedWebSocketUser | undefined, sessionId: string): boolean {
  const session = sessionsDb.getSessionById(sessionId);
  const project = session?.project_path ? projectsDb.getProjectPath(session.project_path) : null;
  return Boolean(session && canAccessProject(user, project?.project_id ?? null));
}

export function broadcastProjectEvent(payload: string, projectId: string | null): void {
  for (const client of connectedClients) {
    if (client.readyState === WS_OPEN_STATE && canAccessProject(clientIdentities.get(client), projectId)) {
      client.send(payload);
    }
  }
}
