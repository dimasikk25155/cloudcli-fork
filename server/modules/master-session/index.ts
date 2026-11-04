/**
 * Мастер-сессия: ждущие вопросы всех чатов и ответы пачкой.
 * Смонтирована в `server/index.js` (`/api/master-session`, authenticateToken);
 * `server/index.js` при этом не меняется — проводку шлюза чата см. в
 * `master-session.runtime.ts`.
 */
import { createMasterSessionRouter } from './master-session.routes.js';
import { getMasterSessionService } from './master-session.runtime.js';

export { createMasterSessionService } from './master-session.service.js';
export { createWorkspaceMasterSendLedger, MASTER_SEND_KIND } from './master-session.ledger.js';
export type { MasterSendLedger } from './master-session.ledger.js';
export type {
  MasterAnswer,
  MasterAnswerInput,
  MasterDraft,
  MasterQuestion,
  MasterQuestionChoice,
  MasterSendItem,
  MasterSendResult,
  MasterSendStatus,
  MasterSessionDependencies,
  MasterSessionService,
} from './master-session.service.js';
export { createMasterSessionRouter } from './master-session.routes.js';
export { getMasterSessionService, setMasterSessionRunControl } from './master-session.runtime.js';

export const masterSessionRoutes = createMasterSessionRouter(getMasterSessionService);
