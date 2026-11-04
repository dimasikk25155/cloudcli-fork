/**
 * HTML preview of project files: `POST /api/projects/:projectId/files/preview`
 * issues a token, `GET /api/file-preview/<token>/<path>` serves the page and
 * its assets under a sandbox CSP. Mounted in `server/index.js`.
 */
export { createFilePreviewService, PreviewError } from './file-preview.service.js';
export { createFilePreviewRoutes } from './file-preview.routes.js';
export { getFilePreviewService } from './file-preview.runtime.js';
