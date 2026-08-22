export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';

// Каталог моделей нужен всем, кто запускает движок сам (agent-run, роуты):
// без экспорта отсюда они лезли во внутренности модуля мимо barrel.
export { providerModelsService } from './services/provider-models.service.js';
