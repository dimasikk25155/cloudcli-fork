/**
 * Боевые зависимости моста: пуш и Telegram с кнопками `br:*`, сторож раз в 30 с.
 * Кнопки: Статус · Починить · Через Митю · Через мой VPS · Авто.
 * Ответ на кнопку — сразу всплывашкой, итог действия — отдельным сообщением
 * (действие идёт до минуты, вебхук его не ждёт).
 */

import { pushSubscriptionsDb, telegramDb, userDb } from '@/modules/database/index.js';
import {
  buildNotificationPayload,
  createNotificationEvent,
  sendDesktopNotification,
  sendWebPushPayload,
} from '@/modules/notifications/index.js';
import { isBotConfigured, registerTelegramCallback, telegramApi } from '@/modules/telegram/index.js';
import { isModOn } from '@/shared/mods.js';

import { createBridgeWatch, type BridgeNotice } from './bridge-watch.js';
import { bridgeService, type BridgeAction } from './bridge.service.js';

export const BRIDGE_NOTICE_CODE = 'bridge.notice';
export const BRIDGE_CALLBACK_PREFIX = 'br:';
const TICK_MS = 30_000;

const PRESS_ACTION: Record<string, BridgeAction | 'status'> = {
  s: 'status',
  f: 'fix',
  a: 'auto',
  m: 'mitya',
  v: 'vps',
};

const ICON: Record<BridgeNotice['kind'], string> = {
  switched: '🟡',
  returned: '🟢',
  down: '🔴',
  off: '⚠️',
  up: '🟢',
};

function adminIds(): number[] {
  return userDb
    .listUsers()
    .filter((user: { role?: string; is_active?: number | string }) => user.role === 'admin' && Number(user.is_active) === 1)
    .map((user: { id: number | string }) => Number(user.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}

function bridgeOn(): boolean {
  const owner = adminIds()[0];
  return owner !== undefined && isModOn(owner, 'modBridge');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ownerChatId(): string | null {
  if (!isBotConfigured()) return null;
  const admins = new Set(adminIds());
  try {
    const binding = (telegramDb.listBindings?.() ?? []).find((row: { user_id?: unknown }) => admins.has(Number(row.user_id)));
    return binding?.chat_id ? String(binding.chat_id) : null;
  } catch {
    return null;
  }
}

export const BRIDGE_BUTTONS = {
  inline_keyboard: [
    [
      { text: 'Статус', callback_data: `${BRIDGE_CALLBACK_PREFIX}s` },
      { text: 'Починить', callback_data: `${BRIDGE_CALLBACK_PREFIX}f` },
    ],
    [
      { text: 'Через Митю', callback_data: `${BRIDGE_CALLBACK_PREFIX}m` },
      { text: 'Через мой VPS', callback_data: `${BRIDGE_CALLBACK_PREFIX}v` },
      { text: 'Авто', callback_data: `${BRIDGE_CALLBACK_PREFIX}a` },
    ],
  ],
};

async function sendTelegram(html: string): Promise<void> {
  const chatId = ownerChatId();
  if (!chatId) return;
  try {
    await telegramApi.sendMessage(chatId, html.slice(0, 3800), { replyMarkup: BRIDGE_BUTTONS });
  } catch {
    // Telegram недоступен — пуш уже ушёл.
  }
}

async function notify(notice: BridgeNotice): Promise<void> {
  const event = createNotificationEvent({
    provider: 'system',
    kind: 'info',
    code: BRIDGE_NOTICE_CODE,
    meta: { title: notice.title, body: notice.body.slice(0, 400), kind: notice.kind },
    severity: notice.kind === 'down' || notice.kind === 'off' ? 'warning' : 'info',
  });
  const payload = buildNotificationPayload(event);
  for (const userId of adminIds()) {
    if (pushSubscriptionsDb.getSubscriptions(userId).length > 0) {
      await sendWebPushPayload(userId, payload).catch(() => undefined);
    }
    try {
      sendDesktopNotification(userId, payload);
    } catch {
      // Настольное приложение может быть закрыто.
    }
  }
  await sendTelegram(`${ICON[notice.kind]} <b>Мост ИИ: ${escapeHtml(notice.title)}</b>\n${escapeHtml(notice.body)}`);
}

const watch = createBridgeWatch({ status: () => bridgeService.status(true), notify, isOn: bridgeOn });
let timer: NodeJS.Timeout | null = null;
let busy = false;
let pressBusy = false;

export function startBridgeWatch(): void {
  // Кнопки работают, даже если сторож выключен переменной.
  registerTelegramCallback(BRIDGE_CALLBACK_PREFIX, async (press) => {
    if (!bridgeOn() || !adminIds().includes(Number(press.binding.user_id))) {
      await press.reply('Пульт моста выключен');
      return;
    }
    const action = PRESS_ACTION[press.data.slice(BRIDGE_CALLBACK_PREFIX.length)];
    if (!action) {
      await press.reply('Неизвестная кнопка');
      return;
    }
    if (pressBusy) {
      await press.reply('Уже выполняю прошлую кнопку — подожди минуту');
      return;
    }
    pressBusy = true;
    await press.reply(action === 'status' ? 'Проверяю оба сервера…' : 'Выполняю, до минуты…');
    void (async () => {
      try {
        if (action === 'status') {
          await sendTelegram(`🌉 <b>Мост ИИ</b>\n${escapeHtml(await bridgeService.statusText())}`);
        } else {
          const result = await bridgeService.act(action);
          const tail = result.status?.text ? `\n${escapeHtml(result.status.text)}` : '';
          await sendTelegram(`${result.ok ? '✅' : '❌'} ${escapeHtml(result.message)}${tail}`);
        }
      } catch (error) {
        await sendTelegram(`❌ Пульт моста упал: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
      } finally {
        pressBusy = false;
      }
    })();
  });

  if (timer || process.env.NEO3_BRIDGE_WATCH === 'off') return;
  const once = () => {
    if (busy) return;
    busy = true;
    void watch.tick().catch(() => undefined).finally(() => {
      busy = false;
    });
  };
  setTimeout(once, 15_000).unref?.();
  timer = setInterval(once, TICK_MS);
  timer.unref?.();
}

export function stopBridgeWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
