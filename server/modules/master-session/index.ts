import express from 'express';

/**
 * Мастер-сессия: ждущие вопросы всех чатов и ответы пачкой.
 * Заготовка сборки «Рабочий стол»: смонтирована в `server/index.js`
 * (`/api/master-session`, authenticateToken); роуты наполняет свой таск,
 * `server/index.js` при этом не меняется.
 */
export const masterSessionRoutes = express.Router();
