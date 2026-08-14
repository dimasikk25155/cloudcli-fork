import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import express from 'express';
import jwt from 'jsonwebtoken';
import mime from 'mime-types';

import { authenticateToken, JWT_SECRET } from '../middleware/auth.js';
import { projectsDb } from '../modules/database/index.js';
import { resolveProjectFilePath } from '../utils/file-reference-resolver.js';

// Ссылка на файл для того, у кого нет доступа в Neo3.
//
// Дима постоянно передаёт файлы наружу: инструкцию другу, архив клиенту, APK.
// Раньше путь был один — скачать себе и переслать вручную, а с телефона это
// боль. Здесь ссылка адресует ОДИН файл: путь запечён в подпись, из URL не
// берётся ничего, кроме токена, поэтому подставить `../` или соседний файл
// нельзя даже теоретически. Живёт сутки и умирает сама.

const router = express.Router();

const SCOPE = 'file-download';
const TTL_SECONDS = 24 * 60 * 60;

/** Подписывает ссылку на конкретный файл. Экспортируется ради тестов. */
export function signDownloadToken(absolutePath, { ttlSeconds = TTL_SECONDS } = {}) {
  return jwt.sign(
    { scope: SCOPE, path: absolutePath, name: path.basename(absolutePath) },
    JWT_SECRET,
    { expiresIn: ttlSeconds },
  );
}

/**
 * Разбирает токен ссылки.
 *
 * Проверка `scope` здесь не формальность: без неё обычный токен сессии, который
 * лежит в браузере, работал бы как ссылка на скачивание чего угодно.
 */
export function readDownloadToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.scope !== SCOPE || typeof payload.path !== 'string' || !payload.path) {
      return null;
    }
    return { path: payload.path, name: payload.name || path.basename(payload.path), exp: payload.exp };
  } catch {
    return null;
  }
}

// Выдать ссылку (только вошедшему; права на файл — те же, что у редактора).
router.post('/share-link', authenticateToken, async (req, res) => {
  try {
    const { projectId, path: filePath } = req.body || {};
    if (!projectId || !filePath) {
      return res.status(400).json({ error: 'projectId и path обязательны' });
    }

    const projectRoot = await projectsDb.getProjectPathById(projectId);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Проект не найден' });
    }

    const outcome = await resolveProjectFilePath({ filePath, projectRoot, user: req.user });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ error: outcome.error });
    }

    let stats;
    try {
      stats = await fsPromises.stat(outcome.resolved);
    } catch {
      return res.status(404).json({ error: 'Файла нет на диске' });
    }
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Ссылка выдаётся на файл, а не на папку' });
    }

    const token = signDownloadToken(outcome.resolved);
    res.json({
      url: `/d/${token}`,
      name: path.basename(outcome.resolved),
      size: stats.size,
      expiresInHours: Math.round(TTL_SECONDS / 3600),
    });
  } catch (error) {
    console.error('Error creating share link:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Публичная отдача файла по подписанной ссылке. Без авторизации — в этом весь смысл. */
export async function serveSharedFile(req, res) {
  const parsed = readDownloadToken(req.params.token);
  if (!parsed) {
    return res.status(401).type('text/plain; charset=utf-8').send('Ссылка недействительна или истекла (они живут сутки).');
  }

  let stats;
  try {
    stats = await fsPromises.stat(parsed.path);
  } catch {
    return res.status(404).type('text/plain; charset=utf-8').send('Файл уже убрали с сервера.');
  }
  if (stats.isDirectory()) {
    return res.status(400).type('text/plain; charset=utf-8').send('По ссылке лежит папка, а не файл.');
  }

  const fileName = path.basename(parsed.path);
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', mime.lookup(parsed.path) || 'application/octet-stream');
  res.setHeader('Content-Length', stats.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );

  const stream = fs.createReadStream(parsed.path);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
}

export default router;
