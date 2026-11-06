import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { getConnection, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { getFilePreviewService } from '@/modules/file-preview/index.js';
import { canAccessProject, canAccessSession } from '@/shared/project-access.js';

import { createArtifactAutoPublish, type ArtifactAutoPublish } from './artifacts-auto.js';
import { createArtifactsService, type ArtifactsService } from './artifacts.service.js';

/**
 * Production wiring: `workspace_records` of the app database, project access
 * by the shared rule, snapshots in `~/.cloudcli/artifacts`. Built on first use,
 * after the server bootstrap has opened the database — imports stay inert.
 */
let service: ArtifactsService | undefined;
let autoPublish: ArtifactAutoPublish | undefined;
type ChangedListener = (event: { projectId: string; artifactId: string }) => void;
let changedListener: ChangedListener | null = null;

/** `server/index.js` sends `artifacts_changed` to the project from here (the websocket module stays out of artifacts). */
export function setArtifactsChangedListener(listener: ChangedListener | null): void {
  changedListener = listener;
}

export function artifactsSessionProjectId(userId: number, sessionId: string): string | null {
  if (!canAccessSession({ id: userId }, sessionId)) return null;
  const session = sessionsDb.getSessionById(sessionId);
  return session?.project_path ? projectsDb.getProjectPath(session.project_path)?.project_id ?? null : null;
}

export function getArtifactsService(): ArtifactsService {
  return service ??= createArtifactsService({
    store: createWorkspaceStore(getConnection()),
    projectPath: (projectId) => projectsDb.getProjectPathById(projectId),
    canAccessProject: (userId, projectId) => canAccessProject({ id: userId }, projectId),
    sessionProjectId: artifactsSessionProjectId,
    // The same grant table the `/api/file-preview` route serves.
    documentGrant: (input) => getFilePreviewService().createDocumentGrant(input),
    onChanged: (event) => changedListener?.(event),
  });
}

/** Pages the agent writes go to «Результаты» by themselves; fed by the chat run registry. */
export function getArtifactAutoPublish(): ArtifactAutoPublish {
  return autoPublish ??= createArtifactAutoPublish({
    publish: (userId, projectId, input) => getArtifactsService().publish(userId, projectId, input),
    projectPath: (projectId) => projectsDb.getProjectPathById(projectId),
  });
}
