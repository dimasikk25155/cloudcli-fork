/**
 * A notice to one user: push (web push + desktop) and a Telegram message to
 * his bound chat. Best effort — a closed channel never throws. Used by
 * «Конвейер» (`queue.done`) and «Расписания» (`schedule.result`); the push
 * look and the panel it opens are set by `buildNotificationPayload`.
 */

import { pushSubscriptionsDb, telegramDb } from '@/modules/database/index.js';

import { sendDesktopNotification } from './desktop-notification-clients.service.js';
import {
  buildNotificationPayload,
  createNotificationEvent,
  sendWebPushPayload,
} from './notification-orchestrator.service.js';

export type OwnerNotice = {
  userId: number;
  /** `queue.done` | `schedule.result` — must be known to `buildNotificationPayload`. */
  code: string;
  title: string;
  body: string;
  severity?: 'info' | 'warning';
  /** Extra fields of the push payload (`queueId`, `scheduleId` → tag). */
  meta?: Record<string, unknown>;
  /** Emoji in front of the Telegram title. */
  icon?: string;
};

const TELEGRAM_MAX = 3800;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(notice: OwnerNotice): Promise<void> {
  const binding = telegramDb.getBindingsByUserId(notice.userId)[0];
  if (!binding?.chat_id) return;
  // Lazy: the Telegram client imports this module's attention helpers.
  const { isBotConfigured, telegramApi } = await import('@/modules/telegram/index.js');
  if (!isBotConfigured()) return;
  const head = `${notice.icon ? `${notice.icon} ` : ''}<b>${escapeHtml(notice.title)}</b>`;
  const html = `${head}\n${escapeHtml(notice.body)}`.slice(0, TELEGRAM_MAX);
  await telegramApi.sendMessage(String(binding.chat_id), html);
}

export async function sendOwnerNotice(notice: OwnerNotice): Promise<void> {
  try {
    const event = createNotificationEvent({
      provider: 'system',
      kind: 'info',
      code: notice.code,
      meta: { ...(notice.meta ?? {}), title: notice.title, body: notice.body },
      severity: notice.severity ?? 'info',
    });
    const payload = buildNotificationPayload(event);
    if (pushSubscriptionsDb.getSubscriptions(notice.userId).length > 0) {
      await sendWebPushPayload(notice.userId, payload).catch(() => undefined);
    }
    try {
      sendDesktopNotification(notice.userId, payload);
    } catch {
      // The desktop app may be closed.
    }
  } catch (error) {
    console.error('[notice] push failed', error instanceof Error ? error.message : String(error));
  }
  try {
    await sendTelegram(notice);
  } catch (error) {
    console.error('[notice] telegram failed', error instanceof Error ? error.message : String(error));
  }
}
