/**
 * Артефакты проекта: публикация, версии, комментарии к участку.
 * Роуты смонтированы в `server/index.js` (`/api/projects/:projectId/artifacts`,
 * authenticateToken, mergeParams). Агентам — `workspace_action`
 * `artifact.publish` / `artifact.list` (`agent-workspace/tools.ts`).
 */
import { createArtifactsRouter } from './artifacts.routes.js';
import { getArtifactsService } from './artifacts.runtime.js';

export { createArtifactsService, ARTIFACT_KIND, ARTIFACT_VERSION_KIND, ARTIFACT_COMMENT_KIND } from './artifacts.service.js';
export type { ArtifactsService, ArtifactsDependencies, ArtifactsFs, SaveEditInput, EditorPreviewInput } from './artifacts.service.js';
export { createArtifactsRouter } from './artifacts.routes.js';
export { getArtifactsService } from './artifacts.runtime.js';

export const artifactsRoutes = createArtifactsRouter(getArtifactsService);
