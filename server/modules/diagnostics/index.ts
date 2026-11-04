import express from 'express';

/**
 * /doctor, /skill-doctor, /advisor.
 * Заготовка сборки «Рабочий стол»: смонтирована в `server/index.js`
 * (`/api/diagnostics`, только authenticateToken). Админ-проверку отчётов
 * делает сам модуль (`isAdminUser`); `/advisor` доступен всем.
 */
export const diagnosticsRoutes = express.Router();
