import express from 'express';

/**
 * Артефакты проекта: публикация, версии, комментарии к участку.
 * Заготовка сборки «Рабочий стол»: смонтирована в `server/index.js`
 * (`/api/projects/:projectId/artifacts`, authenticateToken) — `mergeParams`,
 * чтобы роуты видели `:projectId`. Роуты наполняет свой таск.
 */
export const artifactsRoutes = express.Router({ mergeParams: true });
