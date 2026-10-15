import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
// «Нужен ответ» in Telegram: the bot message a waiting session produces, and
// what pressing its buttons does. Telegram itself is a fetch recorder; the
// engine behind pending-answers is a fake that records delivered decisions.
const BOT_TOKEN = '123456:attention-test-token-not-real';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = 'attention-test-secret';
process.env.NEO3_PUBLIC_URL = 'https://neo3.example';
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'telegram-attention-'));
const previousDatabasePath = process.env.DATABASE_PATH;
const databasePath = path.join(tempDirectory, 'auth.db');
writeFileSync(databasePath, '');
process.env.DATABASE_PATH = databasePath;
const { closeConnection } = await import('../../../modules/database/connection.js');
const { initializeDatabase } = await import('../../../modules/database/init-db.js');
const { projectsDb } = await import('../../../modules/database/repositories/projects.db.js');
const { sessionsDb } = await import('../../../modules/database/repositories/sessions.db.js');
const { userDb } = await import('../../../modules/database/repositories/users.js');
const { userProjectAccessDb } = await import('../../../modules/database/repositories/user-project-access.js');
const { notificationPreferencesDb } = await import('../../../modules/database/repositories/notification-preferences.js');
const { telegramDb } = await import('../../../modules/database/repositories/telegram.db.js');
const { createTelegramAttention, telegramAttention } = await import('../../../modules/telegram/telegram-attention.service.js');
const { handleTelegramUpdate, issueLinkCode } = await import('../../../modules/telegram/telegram.service.js');
const { pendingAnswers } = await import('../../../modules/pending-answers/pending-answers.service.js');
// Fake engine behind pending-answers: a request stays open until delivered once.
const openRequests = new Map();
const delivered = [];
pendingAnswers.setEngine({
    locate: (requestId) => (openRequests.has(requestId)
        ? { requestId, sessionId: openRequests.get(requestId), provider: 'claude', reason: 'ask' }
        : null),
    deliver: async ({ requestId, decision, via }) => {
        if (!openRequests.has(requestId))
            return false;
        openRequests.delete(requestId);
        delivered.push({ requestId, decision, via });
        return true;
    },
});
const originalFetch = globalThis.fetch;
let botCalls = [];
let nextMessageId = 100;
let webhookInfo = {};
/** Chats whose sendMessage fails: HTTP 5xx or network down. */
const failingChats = new Map();
globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.telegram.org/')) {
        throw new Error(`Unexpected outbound request in tests: ${url}`);
    }
    const method = url.split('/').pop() || '';
    botCalls.push({ method, payload: JSON.parse(String(init?.body ?? '{}')) });
    const failure = method === 'sendMessage' ? failingChats.get(String(botCalls.at(-1).payload.chat_id)) : undefined;
    if (failure === 'unreachable') {
        throw new TypeError(`fetch failed for ${url}`);
    }
    if (failure === 'http500') {
        return new Response(JSON.stringify({ ok: false, description: 'Internal Server Error' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (method === 'getWebhookInfo' && webhookInfo === 'unreachable') {
        throw new TypeError(`fetch failed for ${url}`);
    }
    const result = method === 'sendMessage'
        ? { message_id: nextMessageId++ }
        : method === 'getWebhookInfo' ? webhookInfo : true;
    return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
});
const PROJECT = '/workspace/attention-project';
const MEMBER_CHAT = '700001';
const SESSION = 'app-session-tg-1';
let memberId = 0;
let projectId = '';
before(async () => {
    await initializeDatabase();
    memberId = Number(userDb.createUser('member', 'hash').id);
    const created = projectsDb.createProjectPath(PROJECT, 'Сайт <Forel>');
    projectId = created.project.project_id;
    userProjectAccessDb.grantAccess(memberId, projectId, null);
    sessionsDb.createAppSession(SESSION, 'claude', PROJECT);
    sessionsDb.updateSessionCustomName(SESSION, 'Правка шапки');
    telegramDb.upsertBinding({ userId: memberId, chatId: MEMBER_CHAT, telegramUsername: 'member_tg' });
});
beforeEach(() => {
    botCalls = [];
});
after(async () => {
    globalThis.fetch = originalFetch;
    closeConnection();
    if (previousDatabasePath === undefined) {
        delete process.env.DATABASE_PATH;
    }
    else {
        process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
});
let requestCounter = 0;
function nextRequestId() {
    requestCounter += 1;
    return `req-${requestCounter}`;
}
function waitingAsk(requestId, overrides = {}) {
    return {
        sessionId: SESSION,
        userId: memberId,
        projectId,
        provider: 'claude',
        state: 'waiting',
        reason: 'ask',
        detail: {
            requestId,
            question: 'Какой цвет шапки?',
            options: ['Синий', 'Зелёный', 'Красный'],
            questions: [{
                    question: 'Какой цвет шапки?',
                    options: [{ label: 'Синий' }, { label: 'Зелёный' }, { label: 'Красный' }],
                    multiSelect: false,
                }],
        },
        updatedAt: new Date().toISOString(),
        previous: { state: 'working', reason: null, requestId: null },
        ...overrides,
    };
}
function sent() {
    return botCalls.filter((call) => call.method === 'sendMessage');
}
function callbackButtons(call) {
    return (call.payload.reply_markup?.inline_keyboard ?? []).flat().filter((button) => 'callback_data' in button);
}
function urlButtons(call) {
    return (call.payload.reply_markup?.inline_keyboard ?? []).flat().filter((button) => 'url' in button);
}
// --- R20: the message --------------------------------------------------------
test('a single-choice question arrives with every option as its own button row and an «Открыть в Neo3» link', async () => {
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId()));
    const messages = sent();
    assert.equal(messages.length, 1);
    const [message] = messages;
    assert.equal(message.payload.chat_id, MEMBER_CHAT);
    const rows = message.payload.reply_markup.inline_keyboard;
    assert.deepEqual(rows.slice(0, 3).map((row) => row.map((button) => button.text)), [['Синий'], ['Зелёный'], ['Красный']]);
    for (const button of callbackButtons(message)) {
        assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64, 'callback_data fits Telegram limit');
    }
    assert.deepEqual(urlButtons(message), [{ text: 'Открыть в Neo3', url: `https://neo3.example/session/${SESSION}` }]);
    // Project, session, question — with the project name HTML-escaped.
    const text = String(message.payload.text);
    assert.match(text, /Сайт &lt;Forel&gt;/);
    assert.doesNotMatch(text, /<Forel>/);
    assert.match(text, /Правка шапки/);
    assert.match(text, /Какой цвет шапки\?/);
});
// --- R20.2: only bound chats, only with «нужно действие» on ------------------
test('nobody bound, a disabled binding or «нужно действие» off → no Telegram message', async () => {
    const lonelyId = Number(userDb.createUser('lonely', 'hash').id);
    userProjectAccessDb.grantAccess(lonelyId, projectId, null);
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), { userId: lonelyId }));
    assert.equal(sent().length, 0, 'user without a bound chat');
    const mutedId = Number(userDb.createUser('muted', 'hash').id);
    telegramDb.upsertBinding({ userId: mutedId, chatId: '700050', telegramUsername: null });
    notificationPreferencesDb.updatePreferences(mutedId, { events: { actionRequired: false, stop: true, error: true } });
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), { userId: mutedId }));
    assert.equal(sent().length, 0, '«нужно действие» switched off');
    const pausedId = Number(userDb.createUser('paused', 'hash').id);
    telegramDb.upsertBinding({ userId: pausedId, chatId: '700051', telegramUsername: null });
    telegramDb.setBindingEnabled(pausedId, '700051', false);
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), { userId: pausedId }));
    assert.equal(sent().length, 0, 'binding switched off');
    // Control: the same change for the bound member does go out.
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId()));
    assert.equal(sent().length, 1);
});
test('the same request announced twice produces one message', async () => {
    const change = waitingAsk(nextRequestId());
    await telegramAttention.onAttentionChange(change);
    await telegramAttention.onAttentionChange({ ...change, updatedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal(sent().length, 1);
});
// --- Решение 16: button sets ---------------------------------------------------
test('several questions or multiselect → question text only, plus the link', async () => {
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), {
        detail: {
            requestId: 'multi-1',
            question: 'Какой цвет?',
            questions: [
                { question: 'Какой цвет?', options: [{ label: 'Синий' }, { label: 'Красный' }], multiSelect: false },
                { question: 'Какие блоки?', options: [{ label: 'Меню' }, { label: 'Подвал' }], multiSelect: true },
            ],
        },
    }));
    const [message] = sent();
    assert.equal(callbackButtons(message).length, 0);
    assert.equal(urlButtons(message).length, 1);
    assert.match(String(message.payload.text), /Какой цвет\?/);
    assert.match(String(message.payload.text), /Какие блоки\?/);
});
test('a question with ten options gets the first eight as buttons', async () => {
    const labels = Array.from({ length: 10 }, (_, index) => `Вариант ${index + 1}`);
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), {
        detail: {
            requestId: 'many-1',
            question: 'Какой?',
            questions: [{ question: 'Какой?', options: labels.map((label) => ({ label })), multiSelect: false }],
        },
    }));
    const [message] = sent();
    assert.deepEqual(callbackButtons(message).map((button) => button.text), labels.slice(0, 8));
});
test('plan → «Одобрить»; permission → «Разрешить» / «Отклонить»', async () => {
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), {
        reason: 'plan',
        detail: { requestId: 'plan-1', question: 'План правки', excerpt: '1. <header> поменять' },
    }));
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), {
        sessionId: 'app-session-tg-perm',
        reason: 'permission',
        detail: { requestId: 'perm-1', question: 'Bash: rm -rf dist', toolName: 'Bash' },
    }));
    const [plan, permission] = sent();
    assert.deepEqual(callbackButtons(plan).map((button) => button.text), ['Одобрить']);
    assert.match(String(plan.payload.text), /&lt;header&gt;/);
    assert.deepEqual(callbackButtons(permission).map((button) => button.text), ['Разрешить', 'Отклонить']);
    assert.equal(urlButtons(permission).length, 1);
});
// --- R20.1 / R37i.1: pressing a button ----------------------------------------
/** Announces an open question for a user and returns the message one of their chats got. */
async function announceOpenQuestion(userId = memberId, chatId = MEMBER_CHAT) {
    const requestId = nextRequestId();
    openRequests.set(requestId, SESSION);
    botCalls = [];
    await telegramAttention.onAttentionChange(waitingAsk(requestId, { userId }));
    const index = botCalls.findIndex((call) => call.method === 'sendMessage' && call.payload.chat_id === chatId);
    assert.ok(index >= 0, `message sent to ${chatId}`);
    const message = botCalls[index];
    // Message ids are handed out in call order by the recorder.
    const messageId = nextMessageId - sent().length + sent().indexOf(message);
    botCalls = [];
    return { requestId, message, messageId };
}
function userWithAccess(name) {
    const id = Number(userDb.createUser(name, 'hash').id);
    userProjectAccessDb.grantAccess(id, projectId, null);
    return id;
}
function captureLogs() {
    const lines = [];
    const originals = { warn: console.warn, error: console.error, log: console.log };
    const record = (...args) => { lines.push(args.map((arg) => (arg && typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')); };
    console.warn = record;
    console.error = record;
    console.log = record;
    return { lines, restore: () => Object.assign(console, originals) };
}
/** Every `&` in Telegram HTML must start a complete entity. */
function assertWellFormedEntities(html) {
    assert.equal(/&(?!(amp|lt|gt|quot);)/.test(html), false, 'no broken entity');
    assert.equal(/<(?!\/?b>)/.test(html), false, 'only <b> markup, no raw <');
}
function press(chatId, messageId, message, button, from) {
    return handleTelegramUpdate({
        update_id: 9,
        callback_query: {
            id: `cbq-${Math.random()}`,
            from,
            data: button.callback_data,
            message: {
                message_id: messageId,
                chat: { id: Number(chatId), type: Number(chatId) > 0 ? 'private' : 'group' },
                text: 'Нужен ответ',
                reply_markup: message.payload.reply_markup,
            },
        },
    });
}
function popups() {
    return botCalls.filter((call) => call.method === 'answerCallbackQuery').map((call) => String(call.payload.text ?? ''));
}
test('pressing an option answers the session, marks «✓ Ответ: …» and removes the answer buttons', async () => {
    const { requestId, message, messageId } = await announceOpenQuestion();
    const green = callbackButtons(message).find((button) => button.text === 'Зелёный');
    await press(MEMBER_CHAT, messageId, message, green, { id: Number(MEMBER_CHAT), username: 'member_tg' });
    assert.deepEqual(delivered.at(-1), {
        requestId,
        decision: { allow: true, answers: { 'Какой цвет шапки?': 'Зелёный' } },
        via: 'telegram',
    });
    assert.equal(popups().length, 1);
    const edit = botCalls.find((call) => call.method === 'editMessageText');
    assert.ok(edit, 'message edited');
    assert.equal(edit.payload.chat_id, MEMBER_CHAT);
    assert.equal(edit.payload.message_id, messageId);
    assert.match(String(edit.payload.text), /✓ Ответ: <b>Зелёный<\/b>/);
    assert.match(String(edit.payload.text), /Какой цвет шапки\?/, 'original question kept');
    const remaining = (edit.payload.reply_markup?.inline_keyboard ?? []).flat();
    assert.equal(remaining.some((button) => 'callback_data' in button), false);
});
test('a second press on an answered question → «Уже отвечено», nothing delivered twice', async () => {
    const { message, messageId } = await announceOpenQuestion();
    const [first, second] = callbackButtons(message);
    const from = { id: Number(MEMBER_CHAT), username: 'member_tg' };
    await press(MEMBER_CHAT, messageId, message, first, from);
    const deliveredAfterFirst = delivered.length;
    botCalls = [];
    await press(MEMBER_CHAT, messageId, message, first, from);
    await press(MEMBER_CHAT, messageId, message, second, from);
    assert.equal(delivered.length, deliveredAfterFirst);
    assert.deepEqual(popups(), ['Уже отвечено', 'Уже отвечено']);
});
test('a press from someone else → «Это не твой вопрос» and the question stays open', async () => {
    const { requestId, message, messageId } = await announceOpenQuestion();
    const [option] = callbackButtons(message);
    // Another person in the same (group-like) chat: neither the chat itself nor the bound username.
    await press(MEMBER_CHAT, messageId, message, option, { id: 555, username: 'stranger' });
    // A chat bound to a different user replaying the member's button.
    const otherId = Number(userDb.createUser('other', 'hash').id);
    userProjectAccessDb.grantAccess(otherId, projectId, null);
    telegramDb.upsertBinding({ userId: otherId, chatId: '700099', telegramUsername: 'other_tg' });
    await press('700099', 1, message, option, { id: 700099, username: 'other_tg' });
    // A chat bound to nobody.
    await press('700123', 1, message, option, { id: 700123 });
    assert.deepEqual(popups(), ['Это не твой вопрос', 'Это не твой вопрос', 'Это не твой вопрос']);
    assert.equal(delivered.some((entry) => entry.requestId === requestId), false);
    assert.equal(botCalls.some((call) => call.method === 'editMessageText'), false);
    // The member can still answer.
    botCalls = [];
    await press(MEMBER_CHAT, messageId, message, option, { id: Number(MEMBER_CHAT) });
    assert.equal(delivered.at(-1)?.requestId, requestId);
});
// --- Решение 8: the webhook must deliver button presses -------------------------
const WEBHOOK_URL = 'https://neo3.example/api/telegram-webhook';
test('a webhook limited to messages is re-registered with the same URL and secret, adding callback_query', async () => {
    webhookInfo = { url: WEBHOOK_URL, allowed_updates: ['message'], pending_update_count: 2 };
    const result = await telegramAttention.ensureWebhookAcceptsCallbacks();
    assert.deepEqual(result, { action: 'reregistered' });
    const registrations = botCalls.filter((call) => call.method === 'setWebhook');
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].payload.url, WEBHOOK_URL);
    assert.equal(registrations[0].payload.secret_token, 'attention-test-secret');
    assert.deepEqual([...registrations[0].payload.allowed_updates].sort(), ['callback_query', 'message']);
    assert.equal(registrations[0].payload.drop_pending_updates, false, 'queued updates survive');
});
test('a webhook that already gets callback_query (or every update type) is left alone', async () => {
    webhookInfo = { url: WEBHOOK_URL, allowed_updates: ['message', 'callback_query'] };
    assert.deepEqual(await telegramAttention.ensureWebhookAcceptsCallbacks(), { action: 'unchanged' });
    webhookInfo = { url: WEBHOOK_URL };
    assert.deepEqual(await telegramAttention.ensureWebhookAcceptsCallbacks(), { action: 'unchanged' });
    assert.equal(botCalls.some((call) => call.method === 'setWebhook'), false);
});
test('no webhook registered → nothing is registered', async () => {
    webhookInfo = { url: '' };
    const result = await telegramAttention.ensureWebhookAcceptsCallbacks();
    assert.deepEqual(result, { action: 'skipped', reason: 'no_webhook' });
    assert.equal(botCalls.some((call) => call.method === 'setWebhook'), false);
});
test('Telegram unreachable at boot → reported, not thrown', async () => {
    webhookInfo = 'unreachable';
    const logged = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args) => { logged.push(args.map(String).join(' ')); };
    console.error = (...args) => { logged.push(args.map(String).join(' ')); };
    try {
        const result = await telegramAttention.ensureWebhookAcceptsCallbacks();
        assert.deepEqual(result, { action: 'failed' });
    }
    finally {
        console.warn = originalWarn;
        console.error = originalError;
        webhookInfo = {};
    }
    assert.ok(logged.length > 0, 'the failure is logged');
    assert.equal(logged.some((line) => line.includes(BOT_TOKEN)), false, 'bot token never logged');
});
// --- groups: who may press ------------------------------------------------------
test('group chat: the bound username (any letter case) may answer, others and username-less bindings may not', async () => {
    const ownerId = userWithAccess('group-owner');
    const GROUP = '-100500';
    telegramDb.upsertBinding({ userId: ownerId, chatId: GROUP, telegramUsername: 'Group_Owner' });
    const stranger = await announceOpenQuestion(ownerId, GROUP);
    await press(GROUP, stranger.messageId, stranger.message, callbackButtons(stranger.message)[0], { id: 43, username: 'someone_else' });
    assert.deepEqual(popups(), ['Это не твой вопрос']);
    assert.equal(delivered.some((entry) => entry.requestId === stranger.requestId), false);
    botCalls = [];
    await press(GROUP, stranger.messageId, stranger.message, callbackButtons(stranger.message)[0], { id: 42, username: 'group_owner' });
    assert.equal(delivered.at(-1)?.requestId, stranger.requestId, 'bound username, other case');
    const namelessId = userWithAccess('group-nameless');
    const NAMELESS_GROUP = '-100600';
    telegramDb.upsertBinding({ userId: namelessId, chatId: NAMELESS_GROUP, telegramUsername: null });
    const nameless = await announceOpenQuestion(namelessId, NAMELESS_GROUP);
    const button = callbackButtons(nameless.message)[0];
    await press(NAMELESS_GROUP, nameless.messageId, nameless.message, button, { id: 44, username: 'anyone' });
    await press(NAMELESS_GROUP, nameless.messageId, nameless.message, button, { id: 45 });
    assert.deepEqual(popups(), ['Это не твой вопрос', 'Это не твой вопрос']);
    assert.equal(delivered.some((entry) => entry.requestId === nameless.requestId), false);
});
test('a chat bound by /start remembers who sent it: that Telegram id may answer, a matching username alone may not', async () => {
    const ownerId = userWithAccess('start-owner');
    const GROUP = '-100700';
    const { code } = issueLinkCode(ownerId);
    await handleTelegramUpdate({
        update_id: 3,
        message: { chat: { id: Number(GROUP), type: 'group' }, from: { id: 777, username: 'start_owner' }, text: `/start ${code}` },
    });
    assert.equal(telegramDb.getBindingByChatId(GROUP)?.user_id, ownerId);
    const question = await announceOpenQuestion(ownerId, GROUP);
    const button = callbackButtons(question.message)[0];
    // Someone who took over the username later is still not the person who bound the chat.
    await press(GROUP, question.messageId, question.message, button, { id: 778, username: 'start_owner' });
    assert.deepEqual(popups(), ['Это не твой вопрос']);
    botCalls = [];
    await press(GROUP, question.messageId, question.message, button, { id: 777, username: 'renamed_since' });
    assert.equal(delivered.at(-1)?.requestId, question.requestId);
});
// --- Telegram failures while announcing ------------------------------------------
test('sendMessage failing for some chats (5xx, network down) → listener resolves, other chats still get theirs, no bot token in logs', async () => {
    const ownerId = userWithAccess('flaky-owner');
    telegramDb.upsertBinding({ userId: ownerId, chatId: '700201', telegramUsername: null });
    telegramDb.upsertBinding({ userId: ownerId, chatId: '700202', telegramUsername: null });
    telegramDb.upsertBinding({ userId: ownerId, chatId: '700203', telegramUsername: null });
    failingChats.set('700201', 'http500');
    failingChats.set('700202', 'unreachable');
    const logs = captureLogs();
    try {
        await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), { userId: ownerId }));
    }
    finally {
        logs.restore();
        failingChats.clear();
    }
    const attempted = sent().map((call) => call.payload.chat_id).sort();
    assert.deepEqual(attempted, ['700201', '700202', '700203']);
    assert.ok(logs.lines.length >= 2, 'both failures logged');
    assert.equal(logs.lines.some((line) => line.includes(BOT_TOKEN)), false);
});
// --- options that did not become buttons -----------------------------------------
test('options beyond the eight buttons are listed in the text', async () => {
    const labels = Array.from({ length: 10 }, (_, index) => `Вариант ${index + 1}`);
    await telegramAttention.onAttentionChange(waitingAsk(nextRequestId(), {
        detail: {
            requestId: 'many-2',
            question: 'Какой?',
            questions: [{ question: 'Какой?', options: labels.map((label) => ({ label })), multiSelect: false }],
        },
    }));
    const text = String(sent()[0].payload.text);
    assert.match(text, /Вариант 9/);
    assert.match(text, /Вариант 10/);
    assert.doesNotMatch(text, /Вариант 8/);
});
test('no answer tokens (issueTokens failed) → every option is listed in the text, only the link remains', async () => {
    const withoutTokens = createTelegramAttention({
        issueTokens: () => { throw new Error('database is locked'); },
    });
    const logs = captureLogs();
    try {
        await withoutTokens.onAttentionChange(waitingAsk(nextRequestId()));
    }
    finally {
        logs.restore();
    }
    const [message] = sent();
    assert.equal(callbackButtons(message).length, 0);
    assert.equal(urlButtons(message).length, 1);
    const text = String(message.payload.text);
    for (const label of ['Синий', 'Зелёный', 'Красный']) {
        assert.match(text, new RegExp(label));
    }
});
// --- length after escaping --------------------------------------------------------
test('text made of & and < stays within 4096 after escaping, also with «✓ Ответ: …» appended', async () => {
    const LIMIT = 4096;
    const hostile = '&<'.repeat(5000);
    const longLabel = `${'&'.repeat(200)}<b>`;
    const requestId = nextRequestId();
    openRequests.set(requestId, SESSION);
    const sessionLabels = () => ({ projectName: hostile, sessionTitle: hostile });
    const service = createTelegramAttention({ sessionLabels });
    await service.onAttentionChange(waitingAsk(requestId, {
        detail: {
            requestId,
            question: hostile,
            questions: [{ question: hostile, options: [{ label: longLabel }, ...Array.from({ length: 12 }, () => ({ label: hostile }))], multiSelect: false }],
        },
    }));
    await service.onAttentionChange(waitingAsk(nextRequestId(), {
        sessionId: 'app-session-tg-plan-long',
        reason: 'plan',
        detail: { requestId: 'plan-long', question: hostile, excerpt: hostile },
    }));
    const messages = sent();
    assert.equal(messages.length, 2);
    for (const message of messages) {
        const text = String(message.payload.text);
        assert.ok(text.length <= LIMIT, `sent ${text.length} ≤ ${LIMIT}`);
        assertWellFormedEntities(text);
    }
    const askMessage = messages[0];
    const messageId = nextMessageId - 2;
    const first = callbackButtons(askMessage)[0];
    botCalls = [];
    await service.handleCallbackQuery({
        id: 'cbq-long',
        from: { id: Number(MEMBER_CHAT) },
        data: first.callback_data,
        message: { message_id: messageId, chat: { id: Number(MEMBER_CHAT), type: 'private' }, text: hostile, reply_markup: askMessage.payload.reply_markup },
    });
    const edit = botCalls.find((call) => call.method === 'editMessageText');
    assert.ok(edit, 'answered message edited');
    const edited = String(edit.payload.text);
    assert.ok(edited.length <= LIMIT, `edited ${edited.length} ≤ ${LIMIT}`);
    assert.match(edited, /✓ Ответ: <b>&amp;/);
    assertWellFormedEntities(edited);
});
//# sourceMappingURL=telegram-attention.test.js.map