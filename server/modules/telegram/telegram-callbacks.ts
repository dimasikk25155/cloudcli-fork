import type { TelegramBindingRow } from '@/modules/database/index.js';

import { telegramApi } from './telegram-api.client.js';
import { activeBinding, pressedByBoundPerson } from './telegram-attention.service.js';

/**
 * Inline buttons of other modules («Дуэт»: `d:<token>`). The webhook hands a
 * press to the module that owns the prefix — only after checking it came from
 * the bound person in the bound chat. The module never imports the webhook,
 * the webhook never imports the module.
 */
export type TelegramCallbackPress = {
  data: string;
  chatId: string;
  messageId: number;
  binding: TelegramBindingRow;
  /** Popup over the button (and closes the spinner). */
  reply: (text?: string) => Promise<void>;
  /** Drop the buttons from the pressed message (keeps its text). */
  clearButtons: () => Promise<void>;
};

export type TelegramCallbackHandler = (press: TelegramCallbackPress) => Promise<void>;

const handlers = new Map<string, TelegramCallbackHandler>();

export function registerTelegramCallback(prefix: string, handler: TelegramCallbackHandler): void {
  handlers.set(prefix, handler);
}

/** Handled here (true) or not ours — the answer buttons go on to telegramAttention. */
export async function dispatchTelegramCallback(callbackQuery: Record<string, any>): Promise<boolean> {
  const data = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
  const handler = [...handlers.entries()].find(([prefix]) => data.startsWith(prefix))?.[1];
  if (!handler) return false;

  const queryId = String(callbackQuery.id ?? '');
  const reply = async (text?: string) => {
    if (!queryId) return;
    try {
      await telegramApi.answerCallbackQuery(queryId, text);
    } catch {
      // The popup is cosmetic.
    }
  };
  const message = callbackQuery.message;
  const chatId = message?.chat?.id === undefined || message?.chat?.id === null ? '' : String(message.chat.id);
  const messageId = Number(message?.message_id);
  const binding = chatId ? activeBinding(chatId) : null;
  if (!binding || !Number.isFinite(messageId) || !pressedByBoundPerson(callbackQuery.from, chatId, binding)) {
    await reply('Это не твоя кнопка');
    return true;
  }
  await handler({
    data,
    chatId,
    messageId,
    binding,
    reply,
    clearButtons: async () => {
      try {
        await telegramApi.editMessageReplyMarkup(chatId, messageId, null);
      } catch {
        // Stale buttons only say «уже решено» on the next press.
      }
    },
  });
  return true;
}
