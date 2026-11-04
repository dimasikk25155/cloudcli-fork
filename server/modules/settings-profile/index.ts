/**
 * Профиль настроек: предложение агента, предпросмотр, снимок, «Вернуть как было».
 * Смонтировано в `server/index.js` (`/api/settings-profile`, authenticateToken).
 * Агент только предлагает — `workspace_action settings.propose`; применяет человек.
 */
import { createSettingsProfileRouter } from './settings-profile.routes.js';
import { getSettingsProfileService } from './settings-profile.runtime.js';

export { createSettingsProfileService } from './settings-profile.service.js';
export type { SettingsProfileService, SettingsProfileDependencies } from './settings-profile.service.js';
export { createSettingsProfileRouter } from './settings-profile.routes.js';
export { getSettingsProfileService } from './settings-profile.runtime.js';

export const settingsProfileRoutes = createSettingsProfileRouter(getSettingsProfileService);
