import express from 'express';

/**
 * Профиль настроек: предпросмотр изменений, снимок, «Вернуть как было».
 * Заготовка сборки «Рабочий стол»: смонтирована в `server/index.js`
 * (`/api/settings-profile`, authenticateToken); роуты наполняет свой таск.
 */
export const settingsProfileRoutes = express.Router();
