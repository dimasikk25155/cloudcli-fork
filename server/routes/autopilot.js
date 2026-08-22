import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import express from 'express';
import jwt from 'jsonwebtoken';

import { authenticateToken, JWT_SECRET } from '../middleware/auth.js';
import { projectsDb } from '../modules/database/index.js';

// Дашборд скилла autopilot внутри Neo3.
//
// Скилл кладёт в проект `.autopilot/dashboard.html` + `state.js` и открывает
// страницу командой `open`/`xdg-open` — то есть на той машине, где работает
// агент. У Димы агент живёт на VPS, а глаза в телефоне, и сам скилл вдобавок
// запрещает себе открывать что-либо в удалённой сессии. Поэтому дашборд
// отдаёт сервер, а показывает вкладка.
//
// Токен лежит В ПУТИ, а не в query, и это не стилистика: страница обновляет
// себя тегом `<script src="state.js?t=…">`, и любой токен из query был бы
// затёрт этим `?t=`. Из URL не берётся ничего, кроме токена и имени файла из
// белого списка ниже, поэтому `../` подставить некуда.

const router = express.Router();

const SCOPE = 'autopilot-dashboard';
const TTL_SECONDS = 12 * 60 * 60;

// Ровно два файла. Дашборд больше ничего с диска не просит, а `.autopilot/`
// рядом с ними держит бриф, спецификацию и таски — их отдавать наружу незачем.
const ALLOWED_FILES = new Map([
  ['dashboard.html', 'text/html; charset=utf-8'],
  ['state.js', 'application/javascript; charset=utf-8'],
]);

/** Подписывает доступ к `.autopilot/` конкретного проекта. Экспортируется ради тестов. */
export function signDashboardToken(autopilotDir, { ttlSeconds = TTL_SECONDS } = {}) {
  return jwt.sign({ scope: SCOPE, dir: autopilotDir }, JWT_SECRET, { expiresIn: ttlSeconds });
}

/**
 * Разбирает токен дашборда.
 *
 * Проверка `scope` здесь не формальность: без неё обычный токен сессии из
 * браузера работал бы как ключ к чужой папке — ровно та же дыра, что закрыта
 * в `file-share.js`.
 */
export function readDashboardToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.scope !== SCOPE || typeof payload.dir !== 'string' || !payload.dir) {
      return null;
    }
    return { dir: payload.dir };
  } catch {
    return null;
  }
}

/**
 * Есть ли в проекте прогон автопилота, и по какой ссылке смотреть.
 *
 * Вкладка спрашивает это сама и показывается только на «да» — иначе она висела
 * бы в шапке у каждого проекта, где автопилот никогда не запускали.
 */
router.get('/projects/:projectId/autopilot/status', authenticateToken, async (req, res) => {
  try {
    const projectRoot = await projectsDb.getProjectPathById(req.params.projectId);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Проект не найден' });
    }

    const dir = path.join(projectRoot, '.autopilot');
    const dashboard = path.join(dir, 'dashboard.html');

    try {
      await fsPromises.access(dashboard, fs.constants.R_OK);
    } catch {
      return res.json({ available: false });
    }

    // Заголовок и стадия — чтобы вкладка могла подписаться прогоном, а не
    // словом «Автопилот» над чужой сборкой.
    let title = null;
    let finished = false;
    try {
      const raw = await fsPromises.readFile(path.join(dir, 'state.js'), 'utf8');
      const state = JSON.parse(raw.replace(/^\s*window\.STATE\s*=\s*/, ''));
      title = typeof state?.title === 'string' ? state.title : null;
      finished = Boolean(state?.finishedAt);
    } catch {
      // state.js пишется агентом по ходу прогона: пока его нет или он
      // недописан, дашборд сам покажет это человеческим экраном.
    }

    res.json({
      available: true,
      url: `/ap/${signDashboardToken(dir)}/dashboard.html`,
      title,
      finished,
    });
  } catch (error) {
    console.error('Error reading autopilot status:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Отдача дашборда и его состояния по подписанной ссылке. */
export async function serveAutopilotAsset(req, res) {
  const parsed = readDashboardToken(req.params.token);
  if (!parsed) {
    return res
      .status(401)
      .type('text/plain; charset=utf-8')
      .send('Ссылка на дашборд истекла — откройте вкладку «Автопилот» заново.');
  }

  const contentType = ALLOWED_FILES.get(req.params.file);
  if (!contentType) {
    return res.status(404).type('text/plain; charset=utf-8').send('Такого файла у дашборда нет.');
  }

  const target = path.join(parsed.dir, req.params.file);

  let stats;
  try {
    stats = await fsPromises.stat(target);
  } catch {
    return res.status(404).type('text/plain; charset=utf-8').send('Файл дашборда не найден.');
  }
  if (!stats.isFile()) {
    return res.status(404).type('text/plain; charset=utf-8').send('Файл дашборда не найден.');
  }

  // Состояние переписывается каждые несколько секунд, а страница просит его
  // раз в десять — закэшированный ответ показал бы замерший прогон.
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');

  const stream = fs.createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
}

export default router;
