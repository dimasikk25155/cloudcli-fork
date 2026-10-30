import { telegramApi } from './telegram-api.client.js';
import { activeBinding, pressedByBoundPerson } from './telegram-attention.service.js';
const handlers = new Map();
export function registerTelegramCallback(prefix, handler) {
    handlers.set(prefix, handler);
}
/** Handled here (true) or not ours — the answer buttons go on to telegramAttention. */
export async function dispatchTelegramCallback(callbackQuery) {
    const data = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
    const handler = [...handlers.entries()].find(([prefix]) => data.startsWith(prefix))?.[1];
    if (!handler)
        return false;
    const queryId = String(callbackQuery.id ?? '');
    const reply = async (text) => {
        if (!queryId)
            return;
        try {
            await telegramApi.answerCallbackQuery(queryId, text);
        }
        catch {
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
            }
            catch {
                // Stale buttons only say «уже решено» on the next press.
            }
        },
    });
    return true;
}
//# sourceMappingURL=telegram-callbacks.js.map