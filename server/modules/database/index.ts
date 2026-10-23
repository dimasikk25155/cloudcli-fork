export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
export { answerTokensDb } from '@/modules/database/repositories/answer-tokens.db.js';
export type { AnswerTokenRow } from '@/modules/database/repositories/answer-tokens.db.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
export { sessionAutoRelayDb } from '@/modules/database/repositories/auto-relay.db.js';
export type { AutoRelayPatch, AutoRelayState, SessionAutoRelayRow } from '@/modules/database/repositories/auto-relay.db.js';
export { auditDb } from '@/modules/database/repositories/audit.db.js';
export type {
  AppendAuditInput,
  AuditActor,
  AuditEvent,
  AuditOutcome,
  AuditRow,
} from '@/modules/database/repositories/audit.db.js';
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
export { githubTokensDb } from '@/modules/database/repositories/github-tokens.js';
export { memorySuggestionsDb } from '@/modules/database/repositories/memory-suggestions.db.js';
export type {
  MemorySuggestionListRow,
  MemorySuggestionRow,
  MemorySuggestionStatus,
} from '@/modules/database/repositories/memory-suggestions.db.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
export { projectsDb } from '@/modules/database/repositories/projects.db.js';
export { providerPreferencesDb } from '@/modules/database/repositories/provider-preferences.js';
export { pushSubscriptionsDb } from '@/modules/database/repositories/push-subscriptions.js';
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
export { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
export { sessionLinksDb } from '@/modules/database/repositories/session-links.db.js';
export type { SessionLinkRow } from '@/modules/database/repositories/session-links.db.js';
export { sessionAttentionDb } from '@/modules/database/repositories/session-attention.db.js';
export type {
  SessionAttentionListRow,
  SessionAttentionRow,
} from '@/modules/database/repositories/session-attention.db.js';
export { telegramDb } from '@/modules/database/repositories/telegram.db.js';
export type { TelegramBindingRow } from '@/modules/database/repositories/telegram.db.js';
export { sessionThreadsDb, threadTokensDb } from '@/modules/database/repositories/threads.db.js';
export type { SessionThreadRow, ThreadTokenRow } from '@/modules/database/repositories/threads.db.js';
export { uiPreferencesDb } from '@/modules/database/repositories/ui-preferences.js';
export { userDb } from '@/modules/database/repositories/users.js';
export { userProjectAccessDb } from '@/modules/database/repositories/user-project-access.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
