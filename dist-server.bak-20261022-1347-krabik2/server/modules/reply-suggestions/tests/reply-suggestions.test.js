import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { createReplySuggestionsRouter, createReplySuggestionsService, } from '../../../modules/reply-suggestions/index.js';
import { replyFingerprint } from '../../../../shared/reply-fingerprint.js';
const QUESTION_REPLY = 'Лендинг собран.\n\nВыкатить на прод сейчас или подождать до вечера?';
const QUESTION_TURN = [
    { kind: 'text', role: 'user', content: 'Собери лендинг и выкати.' },
    { kind: 'tool_use' },
    { kind: 'text', role: 'assistant', content: QUESTION_REPLY },
];
/** The request body the composer sends: the session and the reply it is showing. */
const askFor = (sessionId, reply = QUESTION_REPLY) => ({ sessionId, replyHash: replyFingerprint(reply) });
async function withServer(dependencies, runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'reply-suggestions-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const admin = userDb.createUserWithRole('dima', 'x', 'admin');
    const member = userDb.createUserWithRole('slava', 'x', 'user');
    const sessionId = sessionsDb.createSession('sess-chips', 'grok', '/workspace/chips', 'Чипы');
    const projectId = projectsDb.getProjectPath('/workspace/chips').project_id;
    const app = express();
    app.use(express.json());
    // Same mount as server/index.js, with authenticateToken stubbed by headers.
    app.use('/api/reply-suggestions', (req, res, next) => {
        const id = req.headers['x-user-id'];
        if (!id) {
            res.sendStatus(401);
            return;
        }
        req.user = { id: Number(id), role: req.headers['x-role'] };
        next();
    }, createReplySuggestionsRouter(createReplySuggestionsService(dependencies)));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/reply-suggestions`;
    try {
        await runTest({
            adminId: Number(admin.id),
            memberId: Number(member.id),
            sessionId,
            projectId,
            post: (userId, role, body) => fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(userId === null ? {} : { 'x-user-id': String(userId), 'x-role': role }),
                },
                body: JSON.stringify(body),
            }),
        });
    }
    finally {
        await new Promise((resolve) => server.close(resolve));
        closeConnection();
        if (previousDatabasePath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousDatabasePath;
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
test('only someone who can open the session gets chips; the model is not asked for anyone else', async () => {
    let modelCalls = 0;
    await withServer({
        fetchHistory: async () => ({ messages: QUESTION_TURN }),
        complete: async () => {
            modelCalls += 1;
            return { suggestions: ['Выкатывай сейчас', 'Давай вечером'] };
        },
    }, async ({ adminId, memberId, sessionId, post }) => {
        const stranger = await post(memberId, 'user', askFor(sessionId));
        assert.equal(stranger.status, 403);
        assert.equal(modelCalls, 0);
        assert.equal((await post(adminId, 'admin', askFor('no-such-session'))).status, 404);
        assert.equal((await post(adminId, 'admin', {})).status, 400);
        assert.equal((await post(adminId, 'admin', { sessionId })).status, 400, 'no reply fingerprint');
        const owner = await post(adminId, 'admin', askFor(sessionId));
        assert.equal(owner.status, 200);
        assert.deepEqual(await owner.json(), { suggestions: ['Выкатывай сейчас', 'Давай вечером'] });
        assert.equal(modelCalls, 1);
    });
});
test('reopening the chat reuses the chips for the same reply; a new reply asks the model again', async () => {
    let history = QUESTION_TURN;
    let modelCalls = 0;
    await withServer({
        fetchHistory: async () => ({ messages: history }),
        complete: async () => {
            modelCalls += 1;
            return { suggestions: [`Вариант ${modelCalls}`, 'Другое'] };
        },
    }, async ({ adminId, memberId, projectId, sessionId, post }) => {
        const first = await (await post(adminId, 'admin', askFor(sessionId))).json();
        const again = await (await post(adminId, 'admin', askFor(sessionId))).json();
        assert.deepEqual(first, { suggestions: ['Вариант 1', 'Другое'] });
        assert.deepEqual(again, first);
        assert.equal(modelCalls, 1);
        // A colleague granted the project sees the same cached chips.
        userProjectAccessDb.grantAccess(memberId, projectId, adminId);
        assert.deepEqual(await (await post(memberId, 'user', askFor(sessionId))).json(), first);
        assert.equal(modelCalls, 1);
        const nextReply = 'Выкатил. Проверишь на телефоне и пришли скрин?';
        history = [
            ...QUESTION_TURN,
            { kind: 'text', role: 'user', content: 'Сейчас.' },
            { kind: 'text', role: 'assistant', content: nextReply },
        ];
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId, nextReply))).json(), { suggestions: ['Вариант 2', 'Другое'] });
        assert.equal(modelCalls, 2);
    });
});
test('a model that is down gives an empty list now and is asked again next time', async () => {
    let up = false;
    let modelCalls = 0;
    await withServer({
        fetchHistory: async () => ({ messages: QUESTION_TURN }),
        complete: async () => {
            modelCalls += 1;
            return up ? { suggestions: ['Давай', 'Не сейчас'] } : null;
        },
    }, async ({ adminId, sessionId, post }) => {
        const down = await post(adminId, 'admin', askFor(sessionId));
        assert.equal(down.status, 200);
        assert.deepEqual(await down.json(), { suggestions: [] });
        up = true;
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId))).json(), { suggestions: ['Давай', 'Не сейчас'] });
        assert.equal(modelCalls, 2);
    });
});
test('the answer is at most three lines of at most 60 characters', async () => {
    const long = 'Давай выкатим прямо сейчас, а вечером я посмотрю метрики и напишу тебе';
    assert.ok(long.length > 60);
    await withServer({
        fetchHistory: async () => ({ messages: QUESTION_TURN }),
        complete: async () => ({ suggestions: [long, 'Да', 'Нет', 'Подожди', 'Ещё вариант'] }),
    }, async ({ adminId, sessionId, post }) => {
        const { suggestions } = (await (await post(adminId, 'admin', askFor(sessionId))).json());
        assert.equal(suggestions.length, 3);
        assert.ok(suggestions.every((line) => line.length <= 60), JSON.stringify(suggestions));
        assert.ok(suggestions[0].startsWith('Давай выкатим прямо сейчас'));
        assert.deepEqual(suggestions.slice(1), ['Да', 'Нет']);
    });
});
test('a turn that ended without a question or request gets no chips and costs no model call', async () => {
    const DONE_REPLY = 'Готово: лендинг на проде, smoke зелёный.';
    let modelCalls = 0;
    await withServer({
        fetchHistory: async () => ({
            messages: [
                { kind: 'text', role: 'user', content: 'Выкати лендинг.' },
                { kind: 'text', role: 'assistant', content: DONE_REPLY },
            ],
        }),
        complete: async () => {
            modelCalls += 1;
            return { suggestions: ['Спасибо'] };
        },
    }, async ({ adminId, sessionId, post }) => {
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId, DONE_REPLY))).json(), { suggestions: [] });
        assert.equal(modelCalls, 0);
    });
});
test('a transcript that lags behind the reply on screen gives no chips and caches nothing', async () => {
    const onScreen = 'Выкатил. Проверишь на телефоне и пришли скрин?';
    let history = QUESTION_TURN; // the server still sees the previous reply
    let modelCalls = 0;
    await withServer({
        fetchHistory: async () => ({ messages: history }),
        complete: async () => {
            modelCalls += 1;
            return { suggestions: ['Проверил, всё ок', 'Скрин кину позже'] };
        },
    }, async ({ adminId, sessionId, post }) => {
        const stale = await post(adminId, 'admin', askFor(sessionId, onScreen));
        assert.equal(stale.status, 200);
        // Not the same as "no question": the client should retry shortly.
        assert.deepEqual(await stale.json(), { suggestions: [], stale: true });
        assert.equal(modelCalls, 0);
        // The transcript catches up: now the chips are generated for real.
        history = [...QUESTION_TURN, { kind: 'text', role: 'user', content: 'Да' }, { kind: 'text', role: 'assistant', content: onScreen }];
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId, onScreen))).json(), { suggestions: ['Проверил, всё ок', 'Скрин кину позже'] });
        assert.equal(modelCalls, 1);
    });
});
test('two requests at the same time for the same reply run the model once', async () => {
    let modelCalls = 0;
    let release = () => { };
    const gate = new Promise((resolve) => { release = resolve; });
    await withServer({
        fetchHistory: async () => ({ messages: QUESTION_TURN }),
        complete: async () => {
            modelCalls += 1;
            await gate;
            return { suggestions: ['Выкатывай сейчас', 'Давай вечером'] };
        },
    }, async ({ adminId, sessionId, post }) => {
        const first = post(adminId, 'admin', askFor(sessionId));
        const second = post(adminId, 'admin', askFor(sessionId));
        await new Promise((resolve) => setTimeout(resolve, 100));
        release();
        const bodies = await Promise.all([first, second].map(async (response) => (await response).json()));
        assert.deepEqual(bodies, [
            { suggestions: ['Выкатывай сейчас', 'Давай вечером'] },
            { suggestions: ['Выкатывай сейчас', 'Давай вечером'] },
        ]);
        assert.equal(modelCalls, 1);
    });
});
test('a single usable chip is not enough: the answer is empty', async () => {
    await withServer({
        fetchHistory: async () => ({ messages: QUESTION_TURN }),
        complete: async () => ({ suggestions: ['Да', '   ', 42] }),
    }, async ({ adminId, sessionId, post }) => {
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId))).json(), { suggestions: [] });
    });
});
test('a reply split into several text blocks with tool calls between them is matched by its last block', async () => {
    // The same normalized transcript the client store holds; the client sends the
    // fingerprint of the last text block, written out here by hand.
    const lastBlock = 'Всё собрал. Выкатывать на прод или сначала на превью?';
    const messages = [
        { kind: 'text', role: 'user', content: 'Собери лендинг.' },
        { kind: 'text', role: 'assistant', content: 'Начинаю: ставлю зависимости.' },
        { kind: 'tool_use' },
        { kind: 'tool_result' },
        { kind: 'text', role: 'assistant', content: 'Сборка прошла, гоняю Lighthouse.' },
        { kind: 'tool_use' },
        { kind: 'text', role: 'assistant', content: `  ${lastBlock}\n` },
        { kind: 'text', role: 'user', content: 'Stop hook feedback: запиши итог в вольт' },
    ];
    await withServer({
        fetchHistory: async () => ({ messages }),
        complete: async () => ({ suggestions: ['На прод', 'Сначала превью'] }),
    }, async ({ adminId, sessionId, post }) => {
        assert.deepEqual(await (await post(adminId, 'admin', askFor(sessionId, lastBlock))).json(), { suggestions: ['На прод', 'Сначала превью'] });
    });
});
/** The user whose «Подсказки ответов» are switched off in the test below. */
let offUser = -1;
test('reply chips switched off: an empty list and the local model is not asked', async () => {
    let modelCalls = 0;
    let historyReads = 0;
    await withServer({
        fetchHistory: async () => {
            historyReads += 1;
            return { messages: QUESTION_TURN };
        },
        complete: async () => {
            modelCalls += 1;
            return { suggestions: ['Выкатывай сейчас', 'Давай вечером'] };
        },
        isModOn: (userId, key) => !(key === 'modReplyChips' && userId === offUser),
    }, async ({ adminId, memberId, projectId, sessionId, post }) => {
        offUser = adminId;
        const response = await post(adminId, 'admin', askFor(sessionId));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { suggestions: [] });
        assert.equal(modelCalls, 0);
        assert.equal(historyReads, 0, 'the transcript is not even read');
        // Another user of the same project keeps the chips.
        userProjectAccessDb.grantAccess(memberId, projectId, adminId);
        const other = await post(memberId, 'user', askFor(sessionId));
        assert.deepEqual(await other.json(), { suggestions: ['Выкатывай сейчас', 'Давай вечером'] });
        assert.equal(modelCalls, 1);
    });
});
//# sourceMappingURL=reply-suggestions.test.js.map