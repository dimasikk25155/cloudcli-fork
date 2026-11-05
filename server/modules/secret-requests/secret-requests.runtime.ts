/**
 * Production wiring of «Запрос ключа»: the real secrets file (`secrets-stash`,
 * exact name — a taken one only with «заменить»), the admin check, the
 * content-free WS frame and a push + Telegram «Агент просит ключ NAME».
 * The push and the Telegram message carry the name and the agent's reason
 * only; the value is typed in Neo3, never in Telegram.
 */

import { sessionsDb, telegramDb } from '@/modules/database/index.js';
import { sendDesktopNotification, sendWebPushPayload } from '@/modules/notifications/index.js';
import { secretNameExists, stashSecret } from '@/modules/secrets-stash/index.js';
import { isAdminUser } from '@/shared/project-access.js';

import { createSecretRequestsRouter } from './secret-requests.routes.js';
import { createSecretRequestsService, type SecretRequestNotice } from './secret-requests.service.js';

export const SECRET_REQUEST_NOTICE_CODE = 'secret.request';
const BODY_MAX = 180;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Push (web + desktop): opens «Ждут тебя» (`/?panel=attention`). */
export function secretRequestPushPayload(notice: SecretRequestNotice) {
  return {
    title: `Агент просит ключ ${notice.name}`,
    body: clip(`${notice.why} — введи значение в «Ждут тебя»`, BODY_MAX),
    data: {
      code: SECRET_REQUEST_NOTICE_CODE,
      tag: `secret:${notice.id}`,
      panel: 'attention',
      urlPath: '/?panel=attention',
      provider: 'system',
    },
  };
}

async function notifyRequested(notice: SecretRequestNotice): Promise<void> {
  const payload = secretRequestPushPayload(notice);
  await sendWebPushPayload(notice.userId, payload).catch(() => undefined);
  try {
    sendDesktopNotification(notice.userId, payload);
  } catch {
    // The desktop app may be closed.
  }
  try {
    const binding = telegramDb.getBindingsByUserId(notice.userId)[0];
    if (!binding?.chat_id) return;
    // Lazy: the Telegram client imports half of the notifications module.
    const { isBotConfigured, telegramApi } = await import('@/modules/telegram/index.js');
    if (!isBotConfigured()) return;
    const html = `🔑 <b>Агент просит ключ ${escapeHtml(notice.name)}</b>\n${escapeHtml(clip(notice.why, 500))}\n`
      + 'Введи значение в Neo3 → «Ждут тебя». Сюда ключ не присылай.';
    await telegramApi.sendMessage(String(binding.chat_id), html);
  } catch (error) {
    console.error('[secret-requests] telegram failed', error instanceof Error ? error.message : String(error));
  }
}

export const secretRequestsService = createSecretRequestsService({
  isAdmin: (userId) => isAdminUser({ id: userId }),
  store: ({ name, value, replace }) => stashSecret({ name, value }, { onExisting: replace ? 'replace' : 'reject' }),
  exists: (name) => secretNameExists(name),
  sessionTitle: (sessionId) => sessionsDb.getSessionById(sessionId)?.custom_name ?? null,
  // Lazy: the websocket module is big and imports half the server.
  onChange: (userId) => {
    void import('@/modules/websocket/index.js')
      .then(({ notifySecretRequestsChanged }) => notifySecretRequestsChanged(userId))
      .catch(() => {});
  },
  onRequested: notifyRequested,
});

export const secretRequestsRoutes = createSecretRequestsRouter({ service: secretRequestsService });
