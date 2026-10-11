// Thin wrapper over the Telegram Bot API.
//
// The bot token is part of the request URL, so nothing in this file may log a
// URL or an error object that carries one — only method names travel to logs.

import crypto from 'node:crypto';

import { appConfigDb } from '@/modules/database/repositories/app-config.js';

const BOT_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 20_000;

const BOT_TOKEN_KEY = 'telegram_bot_token';
const WEBHOOK_SECRET_KEY = 'telegram_webhook_secret';

export type TelegramBotInfo = {
  id: number;
  username?: string;
  first_name?: string;
};

export type TelegramWebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
  /** Absent when the bot never narrowed it — then every update type arrives. */
  allowed_updates?: string[];
};

export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

export type InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][] };

export type TelegramSentMessage = { message_id: number; chat?: { id: number | string } };

/** Update types the webhook subscribes to: text messages and inline-button presses. */
export const WEBHOOK_ALLOWED_UPDATES = ['message', 'callback_query'] as const;

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The stored token wins over the environment: the settings panel writes here,
 * and a value typed by an admin must not be shadowed by a stale .env entry.
 */
export function getBotToken(): string {
  return (appConfigDb.get(BOT_TOKEN_KEY) || '').trim() || readEnv('TELEGRAM_BOT_TOKEN');
}

export function getWebhookSecret(): string {
  return (appConfigDb.get(WEBHOOK_SECRET_KEY) || '').trim() || readEnv('TELEGRAM_WEBHOOK_SECRET');
}

/** Where the live token comes from — the panel shows env tokens as read-only. */
export function getTokenSource(): 'db' | 'env' | 'none' {
  if ((appConfigDb.get(BOT_TOKEN_KEY) || '').trim()) return 'db';
  return readEnv('TELEGRAM_BOT_TOKEN') ? 'env' : 'none';
}

/**
 * Stores a verified token and makes sure a webhook secret exists. The secret is
 * generated instead of asked for: it is an internal shared value between this
 * server and Telegram, and nobody needs to see or choose it.
 */
export function saveBotToken(token: string): void {
  appConfigDb.set(BOT_TOKEN_KEY, token.trim());
  if (!getWebhookSecret()) {
    appConfigDb.set(WEBHOOK_SECRET_KEY, crypto.randomBytes(24).toString('hex'));
  }
}

export function clearBotToken(): void {
  appConfigDb.set(BOT_TOKEN_KEY, '');
}

export function isBotConfigured(): boolean {
  return getBotToken().length > 0;
}

async function callBotApi<T>(
  method: string,
  payload: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  tokenOverride?: string
): Promise<T> {
  const token = (tokenOverride || '').trim() || getBotToken();
  if (!token) {
    throw new Error('Telegram bot token is not configured');
  }

  let response: Response;
  try {
    response = await fetch(`${BOT_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // The original error quotes the request URL (token inside), so it is replaced.
    throw new Error(`Telegram API ${method} is unreachable`);
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string }
    | null;

  if (!response.ok || !body?.ok) {
    throw new Error(`Telegram API ${method} failed: ${body?.description || `HTTP ${response.status}`}`);
  }

  return body.result as T;
}

export const telegramApi = {
  /** `tokenOverride` lets the panel check a token before it is stored anywhere. */
  getMe(tokenOverride?: string): Promise<TelegramBotInfo> {
    return callBotApi<TelegramBotInfo>('getMe', {}, 8_000, tokenOverride);
  },

  getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return callBotApi<TelegramWebhookInfo>('getWebhookInfo', {}, 8_000);
  },

  deleteWebhook(): Promise<unknown> {
    return callBotApi('deleteWebhook', { drop_pending_updates: true }, 8_000);
  },

  /** `text` must already be HTML-escaped and within Telegram's 4096-character limit. */
  sendMessage(
    chatId: string,
    text: string,
    options: { replyMarkup?: InlineKeyboardMarkup | null } = {},
  ): Promise<TelegramSentMessage> {
    return callBotApi<TelegramSentMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  },

  /** Closes the spinner on a pressed inline button; `text` shows as a short popup (≤200 chars). */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return callBotApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text: text.slice(0, 200) } : {}),
    }, 8_000);
  },

  /** Replaces a sent message's text (HTML, already escaped) and its keyboard. */
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    options: { replyMarkup?: InlineKeyboardMarkup | null } = {},
  ): Promise<unknown> {
    return callBotApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: options.replyMarkup ?? { inline_keyboard: [] },
    }, 8_000);
  },

  /** Swaps a sent message's keyboard; null removes every button. */
  editMessageReplyMarkup(chatId: string, messageId: number, replyMarkup: InlineKeyboardMarkup | null): Promise<unknown> {
    return callBotApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    }, 8_000);
  },

  /** Best-effort "bot is alive" indicator; Telegram clears it after ~5 seconds. */
  sendChatAction(chatId: string, action: string = 'typing'): Promise<unknown> {
    return callBotApi('sendChatAction', { chat_id: chatId, action }, 8_000);
  },

  /**
   * `dropPendingUpdates` is on for a fresh registration from the panel and off
   * when an existing webhook is only widened — updates already queued for the
   * same URL must still arrive.
   */
  setWebhook(
    url: string,
    secretToken: string,
    options: { allowedUpdates?: readonly string[]; dropPendingUpdates?: boolean } = {},
  ): Promise<unknown> {
    return callBotApi('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: [...(options.allowedUpdates ?? WEBHOOK_ALLOWED_UPDATES)],
      drop_pending_updates: options.dropPendingUpdates ?? true,
    });
  },
};
