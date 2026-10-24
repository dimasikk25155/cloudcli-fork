/**
 * «Нужен ответ» in Telegram.
 *
 * Subscribed to session-attention: when a session starts waiting for its
 * owner, every enabled Telegram chat bound to that owner gets one message —
 * project, session, question — with one-time answer buttons (Решение 16) and
 * an «Открыть в Neo3» link. Pressing a button redeems its pending-answers
 * token on behalf of the user the chat is bound to; the message then shows
 * «✓ Ответ: …» and loses its answer buttons.
 *
 * callback_data = `a:<token>` (token: 22 base64url chars, well under 64 bytes).
 * The token never appears in logs; neither does the bot token.
 */
import path from 'node:path';
import { notificationPreferencesDb, projectsDb, sessionsDb, userDb } from '../../modules/database/index.js';
import { telegramDb } from '../../modules/database/repositories/telegram.db.js';
import { pickAnswerChoices, singleChoiceQuestion } from '../../modules/notifications/services/attention-push.service.js';
import { pendingAnswers, } from '../../modules/pending-answers/pending-answers.service.js';
import { WEBHOOK_ALLOWED_UPDATES, getWebhookSecret, isBotConfigured, telegramApi, } from '../../modules/telegram/telegram-api.client.js';
import { escapeHtml } from '../../modules/telegram/telegram-format.js';
import { isModActive, isModOn as defaultIsModOn, MOD_OFF, modOffMessage } from '../../shared/mods.js';
/** Telegram: all options of a single-choice question, at most this many. */
export const MAX_TELEGRAM_ANSWER_BUTTONS = 8;
export const ANSWER_CALLBACK_PREFIX = 'a:';
const OPEN_BUTTON_TEXT = 'Открыть в Neo3';
const SENT_TTL_MS = 24 * 60 * 60 * 1000;
const QUESTION_MAX = 600;
const EXCERPT_MAX = 1500;
const BUTTON_TEXT_MAX = 60;
const PROVIDER_LABELS = {
    claude: 'Claude',
    codex: 'Codex',
    grok: 'Grok',
    cursor: 'Cursor',
    gemini: 'Gemini',
    kimi: 'Kimi',
};
const REFUSAL_TEXT = {
    already_answered: 'Уже отвечено',
    invalid: 'Уже отвечено',
    expired: 'Вопрос устарел — ответь в Neo3',
    forbidden: 'Это не твой вопрос',
    in_progress: 'Ответ уже отправляется',
    unavailable: 'Не получилось ответить — открой Neo3',
    [MOD_OFF]: `${modOffMessage('modAnswerButtons')} — ответь в Neo3`,
};
const NOT_YOURS_TEXT = REFUSAL_TEXT.forbidden;
// ---------------------------------------------------------------------------
// Message text
// ---------------------------------------------------------------------------
function clip(text, max) {
    const normalized = String(text ?? '').trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
/** Telegram's message limit, measured on the HTML we send (entities count in full: conservative). */
const TELEGRAM_TEXT_LIMIT = 4096;
const ANSWERED_PREFIX = '\n\n✓ Ответ: <b>';
const ANSWERED_SUFFIX = '</b>';
/** Longest escaped entity is `&quot;` (6 chars per source char). */
const ANSWERED_RESERVE = ANSWERED_PREFIX.length + ANSWERED_SUFFIX.length + BUTTON_TEXT_MAX * 6;
/** Room for the message body, so «✓ Ответ: …» always fits later. */
const MESSAGE_BODY_LIMIT = TELEGRAM_TEXT_LIMIT - ANSWERED_RESERVE;
/**
 * Escapes `text` and cuts it so the escaped form is at most `max` characters,
 * never inside an entity; a cut ends with «…».
 */
function escapeWithin(text, max) {
    const escaped = escapeHtml(text);
    if (escaped.length <= max)
        return escaped;
    if (max <= 1)
        return '';
    let out = '';
    for (const char of String(text ?? '')) {
        const piece = escapeHtml(char);
        if (out.length + piece.length + 1 > max)
            break;
        out += piece;
    }
    return `${out}…`;
}
/**
 * Line-by-line HTML under a hard budget. `markup` is trusted, already-safe
 * HTML; `text` is escaped and trimmed to whatever room is left.
 */
function createHtmlBudget(limit) {
    const lines = [];
    let used = 0;
    return {
        line(markup, text = '', maxText = Infinity) {
            const separator = lines.length > 0 ? 1 : 0;
            const room = limit - used - separator - markup.length;
            if (room < 0)
                return;
            const line = markup + (text ? escapeWithin(clip(text, maxText), room) : '');
            lines.push(line);
            used += separator + line.length;
        },
        html() {
            return lines.join('\n').trim();
        },
    };
}
/**
 * The answered form of a message: body plus «✓ Ответ: label». Bodies are
 * built within MESSAGE_BODY_LIMIT, so the result stays within Telegram's limit.
 */
function answeredHtml(bodyHtml, label) {
    return `${bodyHtml}${ANSWERED_PREFIX}${escapeHtml(clip(label, BUTTON_TEXT_MAX))}${ANSWERED_SUFFIX}`;
}
function defaultSessionLabels(sessionId) {
    const session = sessionsDb.getSessionById(sessionId);
    const projectPath = session?.project_path ?? '';
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
    const projectName = project?.custom_project_name?.trim() || (projectPath ? path.basename(projectPath) : '') || 'Проект';
    const sessionTitle = session?.custom_name?.trim() || 'Сессия без названия';
    return { projectName, sessionTitle };
}
/**
 * HTML body of the «нужен ответ» message (≤ MESSAGE_BODY_LIMIT). Every
 * dynamic piece is escaped. `buttonCount` = how many options of a
 * single-choice question became buttons; the rest are listed in the text.
 */
function buildMessageHtml(change, labels, buttonCount) {
    const provider = PROVIDER_LABELS[change.provider] ?? 'Агент';
    const detail = change.detail ?? {};
    const out = createHtmlBudget(MESSAGE_BODY_LIMIT);
    out.line('<b>Нужен ответ</b> · ', labels.projectName, 120);
    out.line('Сессия: ', labels.sessionTitle, 120);
    out.line('');
    switch (change.reason) {
        case 'ask': {
            const single = singleChoiceQuestion(change);
            if (single) {
                out.line(`${provider} спрашивает: `, single.question || detail.question || 'нужен твой выбор', QUESTION_MAX);
                const rest = single.options.slice(buttonCount);
                if (rest.length > 0) {
                    out.line(buttonCount > 0 ? 'Ещё варианты (ответ в Neo3):' : 'Варианты (ответ в Neo3):');
                    for (const option of rest) {
                        out.line('  — ', option.label, BUTTON_TEXT_MAX);
                    }
                }
                break;
            }
            const questions = detail.questions ?? [];
            out.line(`${provider} спрашивает:`);
            if (questions.length === 0) {
                out.line('', detail.question || 'нужен твой выбор', QUESTION_MAX);
            }
            questions.forEach((question, index) => {
                const marker = questions.length > 1 ? `${index + 1}. ` : '';
                out.line(marker, `${question.question}${question.multiSelect ? ' (можно несколько)' : ''}`, QUESTION_MAX);
                for (const option of question.options) {
                    out.line('  — ', option.label, BUTTON_TEXT_MAX);
                }
            });
            out.line('');
            out.line('Ответить можно в Neo3.');
            break;
        }
        case 'plan':
            out.line(`${provider} просит одобрить план${detail.question ? ': ' : ''}`, detail.question ?? '', QUESTION_MAX);
            if (detail.excerpt) {
                out.line('');
                out.line('', detail.excerpt, EXCERPT_MAX);
            }
            break;
        case 'permission':
            out.line(`${provider} просит разрешение: `, detail.question || detail.toolName || 'инструмент', QUESTION_MAX);
            break;
        case 'manual_ask':
            out.line(`${provider} ждёт твоего действия:`);
            out.line('', detail.excerpt || detail.question || '', EXCERPT_MAX);
            break;
        default:
            out.line(`${provider} ждёт ответа${detail.question || detail.excerpt ? ':' : ''}`);
            if (detail.question || detail.excerpt) {
                out.line('', detail.question || detail.excerpt || '', EXCERPT_MAX);
            }
    }
    return out.html();
}
function openButton(baseUrl, sessionId) {
    return baseUrl ? { text: OPEN_BUTTON_TEXT, url: `${baseUrl}/session/${encodeURIComponent(sessionId)}` } : null;
}
function buildKeyboard(tokens, open) {
    const rows = tokens.map((token) => [{
            text: clip(token.label, BUTTON_TEXT_MAX),
            callback_data: `${ANSWER_CALLBACK_PREFIX}${token.token}`,
        }]);
    if (open)
        rows.push([open]);
    return rows.length > 0 ? { inline_keyboard: rows } : null;
}
/** The keyboard of a sent message minus its answer buttons (link buttons stay). */
function linksOnly(markup) {
    const rows = markup?.inline_keyboard;
    if (!Array.isArray(rows))
        return null;
    const kept = rows
        .map((row) => (Array.isArray(row) ? row.filter((button) => typeof button?.url === 'string') : []))
        .filter((row) => row.length > 0);
    return kept.length > 0 ? { inline_keyboard: kept } : null;
}
// ---------------------------------------------------------------------------
// Public URL for «Открыть в Neo3»
// ---------------------------------------------------------------------------
function httpsOrigin(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.origin : null;
    }
    catch {
        return null;
    }
}
export function createTelegramAttention(dependencies = {}) {
    const api = dependencies.api ?? telegramApi;
    const issueTokens = dependencies.issueTokens
        ?? ((requestId, userId, choices) => pendingAnswers.issueTokens(requestId, userId, choices));
    const redeemToken = dependencies.redeemToken
        ?? ((token, options) => pendingAnswers.redeemToken(token, options));
    const sessionLabels = dependencies.sessionLabels ?? defaultSessionLabels;
    const now = dependencies.now ?? (() => Date.now());
    const isModOn = dependencies.isModOn ?? defaultIsModOn;
    /** Requests already announced: session + request id, or session + turn time. */
    const announced = new Map();
    /** Messages still showing answer buttons, by session. */
    const sentBySession = new Map();
    /** `chat:message` pairs a button press is handling right now. */
    const answering = new Set();
    let webhookOrigin = null;
    function prune() {
        const cutoff = now() - SENT_TTL_MS;
        for (const [key, at] of announced) {
            if (at < cutoff)
                announced.delete(key);
        }
        for (const [sessionId, messages] of sentBySession) {
            const fresh = messages.filter((message) => message.at >= cutoff);
            if (fresh.length === 0)
                sentBySession.delete(sessionId);
            else
                sentBySession.set(sessionId, fresh);
        }
    }
    async function publicBaseUrl() {
        const configured = httpsOrigin(process.env.NEO3_PUBLIC_URL?.trim());
        if (configured)
            return configured;
        if (webhookOrigin)
            return webhookOrigin;
        try {
            webhookOrigin = httpsOrigin((await api.getWebhookInfo())?.url);
        }
        catch {
            webhookOrigin = null;
        }
        return webhookOrigin;
    }
    function messageKey(chatId, messageId) {
        return `${chatId}:${messageId}`;
    }
    function takeSent(chatId, messageId) {
        for (const [sessionId, messages] of sentBySession) {
            const index = messages.findIndex((message) => message.chatId === chatId && message.messageId === messageId);
            if (index >= 0) {
                const [found] = messages.splice(index, 1);
                if (messages.length === 0)
                    sentBySession.delete(sessionId);
                return found;
            }
        }
        return null;
    }
    /** Bindings that get «нужен ответ»: enabled, user exists, «нужно действие» on. */
    function recipientChats(userId) {
        if (!userDb.getUserById(userId))
            return [];
        const preferences = notificationPreferencesDb.getPreferences(userId);
        if (preferences?.events?.actionRequired === false)
            return [];
        return telegramDb.getBindingsByUserId(userId).filter((binding) => Boolean(binding.enabled));
    }
    /** Answered elsewhere (UI, push) or the request went away: answer buttons go. */
    async function closeSession(sessionId) {
        const messages = sentBySession.get(sessionId) ?? [];
        sentBySession.delete(sessionId);
        for (const message of messages) {
            if (answering.has(messageKey(message.chatId, message.messageId)))
                continue;
            try {
                await api.editMessageReplyMarkup(message.chatId, message.messageId, linksOnly(message.keyboard));
            }
            catch {
                // Already edited or deleted by the user — nothing left to clean.
            }
        }
    }
    async function announce(change, userId) {
        const chats = recipientChats(userId);
        if (chats.length === 0)
            return;
        const requestId = change.detail?.requestId ?? null;
        const choices = requestId && isModActive(userId, 'modAnswerButtons', isModOn)
            ? pickAnswerChoices(change, MAX_TELEGRAM_ANSWER_BUTTONS)
            : [];
        let tokens = [];
        if (requestId && choices.length > 0) {
            try {
                tokens = issueTokens(requestId, userId, choices);
            }
            catch (error) {
                // Buttons are a convenience; the message itself must still go out.
                console.error('[TelegramAttention] could not issue answer tokens', { sessionId: change.sessionId, error: error?.message });
            }
        }
        const html = buildMessageHtml(change, sessionLabels(change.sessionId), tokens.length);
        const keyboard = buildKeyboard(tokens, openButton(await publicBaseUrl(), change.sessionId));
        for (const chat of chats) {
            try {
                const sent = await api.sendMessage(chat.chat_id, html, { replyMarkup: keyboard });
                if (tokens.length > 0 && typeof sent?.message_id === 'number') {
                    const list = sentBySession.get(change.sessionId) ?? [];
                    list.push({ chatId: chat.chat_id, messageId: sent.message_id, html, keyboard, at: now() });
                    sentBySession.set(change.sessionId, list);
                }
            }
            catch (error) {
                console.error('[TelegramAttention] could not send «нужен ответ»', { sessionId: change.sessionId, error: error?.message });
            }
        }
    }
    const service = {
        /** session-attention listener. Never rejects: Telegram trouble must not reach the caller. */
        async onAttentionChange(change) {
            try {
                if (!isBotConfigured())
                    return;
                const wasWaiting = change.previous?.state === 'waiting';
                if (change.state !== 'waiting') {
                    if (wasWaiting)
                        await closeSession(change.sessionId);
                    return;
                }
                const requestId = change.detail?.requestId ?? null;
                const isNewRequest = !wasWaiting || (requestId !== null && requestId !== change.previous?.requestId);
                if (!isNewRequest || change.userId === null)
                    return;
                // «Ждут тебя» switched off: no message. Buttons already sent still
                // lose their answer row when the session stops waiting (above).
                if (!isModActive(change.userId, 'modAttention', isModOn))
                    return;
                prune();
                const key = `${change.sessionId}:${requestId ?? `turn:${change.updatedAt}`}`;
                if (announced.has(key))
                    return;
                announced.set(key, now());
                if (wasWaiting) {
                    // A new question replaced the old one: the old buttons are dead.
                    await closeSession(change.sessionId);
                }
                await announce(change, change.userId);
            }
            catch (error) {
                console.error('[TelegramAttention] listener failed', { sessionId: change.sessionId, error: error?.message });
            }
        },
        /** True when the callback_query is an answer button press (handled here). */
        isAnswerCallback(data) {
            return typeof data === 'string' && data.startsWith(ANSWER_CALLBACK_PREFIX);
        },
        /**
         * A button under a «нужен ответ» message was pressed. The chat must be
         * bound, the presser must be the bound person (private chat: the chat
         * itself; group: the bound username), and the token must belong to the
         * bound user — otherwise «Это не твой вопрос».
         */
        async handleCallbackQuery(callbackQuery) {
            const queryId = typeof callbackQuery?.id === 'string' ? callbackQuery.id : String(callbackQuery?.id ?? '');
            if (!queryId)
                return;
            const reply = async (text) => {
                try {
                    await api.answerCallbackQuery(queryId, text);
                }
                catch {
                    // The popup is cosmetic; Telegram closes the spinner on its own.
                }
            };
            const data = typeof callbackQuery.data === 'string' ? callbackQuery.data : '';
            const message = callbackQuery.message;
            const chatId = message?.chat?.id === undefined || message?.chat?.id === null ? '' : String(message.chat.id);
            const messageId = Number(message?.message_id);
            if (!service.isAnswerCallback(data) || !chatId || !Number.isFinite(messageId)) {
                await reply();
                return;
            }
            const binding = activeBinding(chatId);
            if (!binding || !pressedByBoundPerson(callbackQuery.from, chatId, binding)) {
                await reply(NOT_YOURS_TEXT);
                return;
            }
            const key = messageKey(chatId, messageId);
            answering.add(key);
            try {
                const token = data.slice(ANSWER_CALLBACK_PREFIX.length);
                const result = await redeemToken(token, { actorUserId: binding.user_id, via: 'telegram' });
                if (result.ok) {
                    const tracked = takeSent(chatId, messageId);
                    const html = tracked?.html ?? escapeWithin(String(message.text ?? ''), MESSAGE_BODY_LIMIT);
                    await reply(`Ответ отправлен: ${clip(result.label, 150)}`);
                    try {
                        await api.editMessageText(chatId, messageId, answeredHtml(html, result.label), {
                            replyMarkup: linksOnly(tracked?.keyboard ?? message.reply_markup),
                        });
                    }
                    catch {
                        // The answer is delivered; a failed edit only leaves stale buttons,
                        // and pressing them again says «уже отвечено».
                    }
                    return;
                }
                await reply(REFUSAL_TEXT[result.reason] ?? REFUSAL_TEXT.unavailable);
                if (result.reason === 'already_answered' || result.reason === 'invalid' || result.reason === 'expired' || result.reason === MOD_OFF) {
                    takeSent(chatId, messageId);
                    try {
                        await api.editMessageReplyMarkup(chatId, messageId, linksOnly(message.reply_markup));
                    }
                    catch {
                        // Best effort cleanup of dead buttons.
                    }
                }
            }
            finally {
                answering.delete(key);
            }
        },
        /**
         * Boot check (Решение 8): with a bound chat and a webhook that narrows
         * allowed_updates without callback_query, re-register the same URL with
         * the same secret, adding callback_query. Idempotent; never throws.
         */
        async ensureWebhookAcceptsCallbacks() {
            try {
                if (!isBotConfigured())
                    return { action: 'skipped', reason: 'not_configured' };
                if (telegramDb.listBindings().length === 0)
                    return { action: 'skipped', reason: 'no_bindings' };
                const secret = getWebhookSecret();
                if (!secret)
                    return { action: 'skipped', reason: 'no_secret' };
                const info = await api.getWebhookInfo();
                const url = typeof info?.url === 'string' ? info.url : '';
                if (!url)
                    return { action: 'skipped', reason: 'no_webhook' };
                webhookOrigin = httpsOrigin(url) ?? webhookOrigin;
                const allowed = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
                // An empty / absent list means "every update type" — callbacks already arrive.
                if (allowed.length === 0 || allowed.includes('callback_query'))
                    return { action: 'unchanged' };
                const widened = Array.from(new Set([...allowed, ...WEBHOOK_ALLOWED_UPDATES]));
                await api.setWebhook(url, secret, { allowedUpdates: widened, dropPendingUpdates: false });
                return { action: 'reregistered' };
            }
            catch (error) {
                console.warn('[TelegramAttention] webhook check failed:', error?.message || 'unknown error');
                return { action: 'failed' };
            }
        },
    };
    return service;
}
/** Same rule as the bot's message handling: enabled binding of a user that still exists. */
function activeBinding(chatId) {
    const binding = telegramDb.getBindingByChatId(chatId);
    if (!binding || !binding.enabled)
        return null;
    if (!userDb.getUserById(Number(binding.user_id)))
        return null;
    return binding;
}
/**
 * Who may press: the Telegram user who sent /start (stored id). Bindings made
 * before the id was stored fall back to the private chat itself, then to the
 * bound username (case-insensitive); no username → nobody else.
 */
function pressedByBoundPerson(from, chatId, binding) {
    const fromId = from?.id === undefined || from?.id === null ? '' : String(from.id);
    if (binding.telegram_user_id)
        return fromId !== '' && fromId === binding.telegram_user_id;
    if (fromId && fromId === chatId)
        return true;
    const username = typeof from?.username === 'string' ? from.username.toLowerCase() : '';
    return Boolean(username && binding.telegram_username && binding.telegram_username.toLowerCase() === username);
}
/** Process-wide instance: the attention listener and the webhook share its message memory. */
export const telegramAttention = createTelegramAttention();
//# sourceMappingURL=telegram-attention.service.js.map