import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import express from 'express';
import mime from 'mime-types';
import multer from 'multer';

import {
  buildStoredImageRecords,
  ensureImageAssetsDir,
  resolveImageAssetFile,
} from '@/modules/assets/services/image-assets.service.js';

// Content types safe to render inline in the chat UI. Everything else is served
// as a download (Content-Disposition: attachment) to avoid stored-XSS from,
// e.g., SVG or HTML uploads rendered as documents.
const INLINE_SAFE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const router = express.Router();

// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
/**
 * Paths multer has started writing for this request. An upload that dies
 * mid-flight (the mobile case) may never reach the route handler at all, so
 * the abort handler needs its own record of what to delete.
 */
type UploadTracking = { assetsDir: string; paths: string[] };
const trackingByRequest = new WeakMap<express.Request, UploadTracking>();

function trackRequest(req: express.Request): UploadTracking {
  let tracking = trackingByRequest.get(req);
  if (!tracking) {
    tracking = { assetsDir: '', paths: [] };
    trackingByRequest.set(req, tracking);
  }
  return tracking;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => {
        trackRequest(req).assetsDir = assetsDir;
        cb(null, assetsDir);
      })
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const name = `${uniqueSuffix}-${sanitizedName}`;
    const tracking = trackRequest(req);
    tracking.paths.push(path.join(tracking.assetsDir, name));
    cb(null, name);
  },
});

/** Max files per upload (must match MAX_ATTACHED_FILES in the composer). */
const MAX_ATTACHED_FILES = 20;

const upload = multer({
  storage,
  // Any file type is accepted: images become vision blocks, everything else is
  // referenced by path so the agent reads it with its own tools. Size is the
  // only gate here (per-file cap below).
  limits: {
    // 100 МБ: столько же стоит в композере (MAX_ATTACHMENT_MB). Выше поднимать
    // нет смысла — упрёмся уже не сюда, а в терпение на аплоаде.
    fileSize: 100 * 1024 * 1024,
    files: MAX_ATTACHED_FILES,
  },
});

/**
 * Stores chat image attachments in the global `~/.cloudcli/assets` folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
  // A connection that drops mid-upload used to leave a half-written file
  // behind: the client saw the failure, the truncated file stayed on disk.
  req.on('aborted', () => {
    const tracking = trackingByRequest.get(req);
    if (!tracking) {
      return;
    }
    // Give multer's write stream a moment to unwind before removing.
    setTimeout(() => discardPaths(tracking.paths), 1_000);
  });

  upload.array('images', MAX_ATTACHED_FILES)(req, res, (err: unknown) => {
    const files = Array.isArray(req.files) ? req.files : [];

    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      discardFiles(files);
      return res.status(400).json({ error: message });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // A mobile upload that breaks off mid-flight still reaches this handler,
    // with a partially written file on disk. Storing it produced a corrupt
    // attachment the model could not decode, so compare what landed against
    // the sizes the client announced and refuse anything short.
    const truncated = findTruncatedUpload(files, req.body?.sizes);
    if (truncated) {
      discardFiles(files);
      return res.status(400).json({ error: truncated });
    }

    res.json({ images: buildStoredImageRecords(files) });
  });
});

/** Removes stored files for a rejected upload; best-effort, never throws. */
function discardFiles(files: Express.Multer.File[]): void {
  discardPaths(files.map((file) => file.path));
}

function discardPaths(paths: string[]): void {
  for (const filePath of paths) {
    fs.unlink(filePath).catch(() => undefined);
  }
}

/**
 * Compares each stored file against the byte count the client sent alongside
 * it. Returns an error message for the first short file, or null when every
 * file arrived whole (or the client sent no sizes — older clients).
 */
function findTruncatedUpload(
  files: Express.Multer.File[],
  rawSizes: unknown
): string | null {
  const sizes = (Array.isArray(rawSizes) ? rawSizes : [rawSizes])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (sizes.length !== files.length) {
    return null;
  }

  for (const [index, file] of files.entries()) {
    if (file.size !== sizes[index]) {
      return `Upload of "${file.originalname}" was cut off (${file.size} of ${sizes[index]} bytes) — check the connection and try again.`;
    }
  }
  return null;
}

/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
  const resolved = resolveImageAssetFile(req.params.filename);
  if (!resolved) {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }

  try {
    await fs.access(resolved);
  } catch {
    return res.status(404).json({ error: 'Asset not found' });
  }

  const contentType = mime.lookup(resolved) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  // Stored-XSS hardening: never let the browser sniff a different type, and
  // serve anything that isn't a plain raster image (SVG, PDF, HTML, archives,
  // ...) as a download instead of rendering it inline. The chat UI is
  // unaffected — it fetches assets as blobs and shows images through <img>,
  // while non-image files render as download chips.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!INLINE_SAFE_CONTENT_TYPES.has(contentType)) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  const fileStream = fsSync.createReadStream(resolved);
  fileStream.pipe(res);
  fileStream.on('error', (error) => {
    console.error('Error streaming image asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

export default router;
