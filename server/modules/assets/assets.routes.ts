import fsSync, { promises as fs } from 'node:fs';

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
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => cb(null, assetsDir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  },
});

const upload = multer({
  storage,
  // Any file type is accepted: images become vision blocks, everything else is
  // referenced by path so the agent reads it with its own tools. Size is the
  // only gate here (per-file cap below).
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
    files: 5,
  },
});

/**
 * Stores chat image attachments in the global `~/.cloudcli/assets` folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
  upload.array('images', 5)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    res.json({ images: buildStoredImageRecords(files) });
  });
});

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
