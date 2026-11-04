import { canAccessProject } from '@/shared/project-access.js';

import { createFilePreviewService } from './file-preview.service.js';

/**
 * The one preview service of the process: grants issued by «Открыть превью»
 * and by the artifact editor («копия документа») are served by the same
 * `/api/file-preview` route, so both must live in the same grant table.
 */
let service: ReturnType<typeof createFilePreviewService> | undefined;

export function getFilePreviewService(): ReturnType<typeof createFilePreviewService> {
  return service ??= createFilePreviewService({ canAccess: (userId, projectId) => canAccessProject({ id: userId }, projectId) });
}
