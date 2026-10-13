/**
 * Auto-relay pushes through the existing notification orchestrator (same
 * channels and preferences as every other push). «Перенёс в новый чат» opens
 * the continuation; a failure opens the chat that stayed where it was.
 */

import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

import type { AutoRelayNotice } from './auto-relay.service.js';

export const AUTO_RELAY_DONE_CODE = 'auto_relay.done';
export const AUTO_RELAY_FAILED_CODE = 'auto_relay.failed';

export function pushAutoRelayNotice(notice: AutoRelayNotice): void {
  if (notice.kind === 'done') {
    notifyUserIfEnabled({
      userId: notice.userId,
      event: createNotificationEvent({
        provider: notice.provider,
        sessionId: notice.childSessionId,
        code: AUTO_RELAY_DONE_CODE,
        meta: { childTitle: notice.childTitle, parentSessionId: notice.sessionId },
        dedupeKey: `auto-relay:done:${notice.sessionId}`,
      }),
    });
    return;
  }
  notifyUserIfEnabled({
    userId: notice.userId,
    event: createNotificationEvent({
      provider: notice.provider,
      sessionId: notice.sessionId,
      kind: 'error',
      code: AUTO_RELAY_FAILED_CODE,
      meta: { error: notice.error },
      severity: 'error',
      dedupeKey: `auto-relay:failed:${notice.sessionId}`,
    }),
  });
}
