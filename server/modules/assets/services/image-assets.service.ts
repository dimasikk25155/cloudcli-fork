import { promises as fs } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { getGlobalImageAssetsDir, toPosixPath } from '@/shared/image-attachments.js';

/**
 * Image mime types accepted for chat attachment uploads. SVG is allowed for
 * storage/preview even though some providers (Claude API) skip it at send time.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// Used only by this service and the assets routes via the barrel file.
type StoredImageAsset = {
  /** Original upload filename, for display. */
  name: string;
  /** Absolute posix-normalized path inside the global assets folder. */
  path: string;
  size: number;
  mimeType: string;
};

// Shape of one multer-stored file; kept local because only this module reads it.
type UploadedImageFile = {
  originalname: string;
  filename: string;
  size: number;
  mimetype: string;
};

/** Returns whether one uploaded mime type may be stored as a chat image asset. */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Resolves the image mime type to trust for an upload. Android WebView gallery
 * picks often arrive with an empty or `application/octet-stream` mime type, so
 * when the reported type isn't an accepted image type we infer one from the
 * filename extension. Returns null when neither yields an accepted image type,
 * which the upload filter treats as a rejected file.
 */
export function resolveUploadedImageMimeType(reportedMimeType: string, filename: string): string | null {
  if (isAllowedImageMimeType(reportedMimeType)) {
    return reportedMimeType;
  }
  const inferred = mime.lookup(filename || '');
  return inferred && isAllowedImageMimeType(inferred) ? inferred : null;
}

/** Creates the global `~/.cloudcli/assets` folder if needed and returns it. */
export async function ensureImageAssetsDir(): Promise<string> {
  const assetsDir = getGlobalImageAssetsDir();
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

/**
 * Maps multer-stored upload files to the attachment records returned to the
 * chat composer. The absolute path is what providers receive and what session
 * history carries back to the UI.
 */
export function buildStoredImageRecords(files: UploadedImageFile[]): StoredImageAsset[] {
  const assetsDir = getGlobalImageAssetsDir();
  return files.map((file) => ({
    name: file.originalname,
    path: toPosixPath(path.join(assetsDir, file.filename)),
    size: file.size,
    // Normalize the type so the attachment split and provider vision path get a
    // valid media_type even when the upload arrived with an empty/generic one:
    // prefer an accepted image type, else infer from the extension, else keep
    // whatever was reported (or a generic binary type for non-image files).
    mimeType:
      resolveUploadedImageMimeType(file.mimetype, file.originalname) ||
      (mime.lookup(file.originalname || '') || file.mimetype || 'application/octet-stream'),
  }));
}

/**
 * Resolves one asset filename to its absolute path inside the global assets
 * folder, or null when the name is empty, contains path separators/traversal,
 * or would escape the folder. This is the only lookup the serving route uses,
 * so nothing outside `~/.cloudcli/assets` can ever be read through it.
 */
export function resolveImageAssetFile(filename: string): string | null {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return null;
  }

  const assetsDir = path.resolve(getGlobalImageAssetsDir());
  const resolved = path.resolve(assetsDir, trimmed);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    return null;
  }

  return resolved;
}
