import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionAutoRelayDb, sessionLinksDb, sessionsDb, sessionThreadsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { clearRunOptions, createAutoRelayService, rememberRunOptions, thresholdsFromEnv, } from '../../../modules/auto-relay/index.js';
const WINDOW = 200_000;
const NONCE = 'k7q2';
const REQUEST_TAG = 'эстафета k7q2';
async function withWorld(runTest, options = {}) {
    const previous = process.env.DATABASE_PATH;
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'auto-relay-service-')));
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
        const member = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
        const outsider = Number(userDb.createUserWithRole('outsider', 'unused', 'user').id);
        const projectDir = path.join(directory, 'project-a');
        await mkdir(projectDir, { recursive: true });
        const project = projectsDb.createProjectPath(projectDir).project;
        userProjectAccessDb.grantAccess(member, project.project_id, admin);
        const starts = [];
        const notices = [];
        const frames = [];
        const seen = [];
        const running = new Set();
        const attention = new Map();
        const messages = new Map();
        const usage = new Map();
        const background = new Map();
        const limit = { blocked: false, checks: 0 };
        const afterFetch = { hook: null };
        const fetchCounts = new Map();
        const timers = [];
        const service = createAutoRelayService({
            now: () => new Date('2026-10-12T10:00:00.000Z'),
            isProcessing: (sessionId) => running.has(sessionId),
            attentionOf: (sessionId) => attention.get(sessionId) ?? null,
            fetchMessages: async (sessionId) => {
                const result = [...(messages.get(sessionId) ?? [])];
                const n = (fetchCounts.get(sessionId) ?? 0) + 1;
                fetchCounts.set(sessionId, n);
                afterFetch.hook?.(sessionId, n);
                return result;
            },
            setTimer: (fire, ms) => {
                const timer = { ms, fire, cancelled: false };
                timers.push(timer);
                return () => { timer.cancelled = true; };
            },
            usageOf: (sessionId) => ({ usedTokens: usage.get(sessionId) ?? null, model: null }),
            contextWindowOf: async () => WINDOW,
            checkClaudeLimit: async () => {
                limit.checks += 1;
                return limit.blocked ? { blocked: true, notice: 'лимит' } : { blocked: false };
            },
            newChatsDefault: () => options.newChatsDefault === true,
            notify: (notice) => { notices.push(notice); },
            broadcast: (payload) => { frames.push(payload); },
            broadcastUpsert: () => { },
            markSeen: (userId, sessionId) => { seen.push({ userId, sessionId }); },
            sleep: async () => { },
            nonce: () => NONCE,
        });
        service.setRunControl({
            start: (input) => {
                if (running.has(input.sessionId))
                    return false;
                starts.push(input);
                running.add(input.sessionId);
                return true;
            },
            backgroundTaskCount: (sessionId) => background.get(sessionId) ?? 0,
        });
        const chatId = 'chat-big';
        sessionsDb.createAppSession(chatId, 'claude', project.project_path);
        sessionsDb.updateSessionCustomName(chatId, 'Сайт кафе');
        messages.set(chatId, [
            { kind: 'text', role: 'user', content: 'Сделай меню' },
            { kind: 'text', role: 'assistant', content: 'Меню готово.' },
        ]);
        await runTest({
            service, starts, notices, frames, seen, running, attention, messages, usage, background, limit, afterFetch, timers,
            member, outsider, projectPath: project.project_path, chatId,
        });
    }
    finally {
        clearRunOptions();
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(directory, { recursive: true, force: true });
    }
}
/** The chat's turn ended: the run is over and session-attention says so. */
function turnEnded(world, sessionId, state = 'done', reason = null) {
    world.running.delete(sessionId);
    world.attention.set(sessionId, { state, reason });
    return { sessionId, userId: world.member, state, reason };
}
function arm(world, sessionId = world.chatId) {
    world.service.setEnabled(sessionId, true, world.member);
}
async function writeNote(world, name) {
    const file = path.join(world.projectPath, 'docs', 'handoff', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '# Эстафета\nСделано: меню. Дальше: корзина.\n');
    return file;
}
/** The agent answered the handoff request with a note line. */
function agentWroteNote(world, sessionId, line) {
    world.messages.set(sessionId, [
        ...(world.messages.get(sessionId) ?? []),
        { kind: 'text', role: 'user', content: world.starts.at(-1)?.content ?? '' },
        { kind: 'text', role: 'assistant', content: `Записку собрал.\n${line}` },
    ]);
}
test('the switch is off by default: a grown chat does not move', async () => {
    await withWorld(async (world) => {
        world.usage.set(world.chatId, 150_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0);
        assert.deepEqual({ enabled: world.service.getStatus(world.chatId).enabled, state: world.service.getStatus(world.chatId).state }, { enabled: false, state: null });
    });
});
test('below the threshold nothing happens; at half of the window the handoff request goes into the chat', async () => {
    await withWorld(async (world) => {
        arm(world);
        rememberRunOptions(world.chatId, { model: 'sonnet[1m]', effort: 'high', permissionMode: 'acceptEdits', images: [{ path: 'x.png' }] });
        world.usage.set(world.chatId, 99_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0);
        assert.equal(existsSync(path.join(world.projectPath, 'docs', 'handoff')), false);
        world.usage.set(world.chatId, 100_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 1);
        const start = world.starts[0];
        assert.equal(start.sessionId, world.chatId);
        assert.equal(start.userId, world.member);
        assert.match(start.content, /^Переносим работу в новый чат \(эстафета k7q2\)\./);
        assert.match(start.content, /HANDOFF_FILE: <путь>/);
        assert.ok(start.content.includes(`Корень проекта: ${world.projectPath}. Полный путь папки для записки: ${world.projectPath}/docs/handoff/ — клади записку именно туда.`));
        assert.deepEqual(start.options, { model: 'sonnet[1m]', effort: 'high', permissionMode: 'acceptEdits' });
        assert.equal(world.service.getStatus(world.chatId).state, 'collecting');
        assert.equal(world.limit.checks, 1);
        assert.match(start.content, /Папка уже создана: запиши записку инструментом Write, без команд терминала\./);
        assert.equal(existsSync(path.join(world.projectPath, 'docs', 'handoff')), true);
    });
});
test('nothing starts while the chat waits for a human, runs, has open threads or background tasks', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 180_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId, 'waiting', 'text_question'));
        assert.equal(world.starts.length, 0, 'waiting for an answer');
        const change = turnEnded(world, world.chatId);
        world.running.add(world.chatId);
        await world.service.handleAttentionChange(change);
        assert.equal(world.starts.length, 0, 'a new run already started');
        world.running.delete(world.chatId);
        world.background.set(world.chatId, 1);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0, 'background task');
        world.background.delete(world.chatId);
        sessionsDb.createAppSession('thread-1', 'grok', world.projectPath);
        sessionLinksDb.setParent('thread-1', world.chatId, 'thread');
        sessionThreadsDb.insert({
            thread_session_id: 'thread-1', parent_session_id: world.chatId, user_id: world.member, provider: 'grok',
            model: null, permission_mode: null, created_at: 't', started_at: 't', seen_at: null, notified_at: null,
        });
        world.running.add('thread-1');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0, 'thread working');
        world.running.delete('thread-1');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0, 'thread result not delivered to the parent yet');
        sessionThreadsDb.markNotified(['thread-1'], 't2');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 1, 'everything settled');
    });
});
test('a chat whose last turn was a hand-typed relay request is left to the band', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 180_000);
        world.messages.set(world.chatId, [
            { kind: 'text', role: 'user', content: 'Переносим работу в новый чат (эстафета ab12).\nСобери эстафету…' },
            { kind: 'text', role: 'assistant', content: 'HANDOFF_FILE: docs/handoff/x.md' },
        ]);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0);
    });
});
test('Claude waits for the 5-hour guard; a local model skips it and spends no subscription', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 180_000);
        world.limit.blocked = true;
        rememberRunOptions(world.chatId, { model: 'opus[1m]' });
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 0);
        assert.equal(world.service.getStatus(world.chatId).state, null, 'tries again at the next turn end');
        rememberRunOptions(world.chatId, { model: 'local-qwen35-9b' });
        const checksBefore = world.limit.checks;
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 1);
        assert.equal(world.starts[0].options.usageGuardOverride, true);
        assert.equal(world.limit.checks, checksBefore);
    });
});
test('the note leads to a linked continuation on the same engine, started with the note, once', async () => {
    await withWorld(async (world) => {
        arm(world);
        rememberRunOptions(world.chatId, { model: 'sonnet[1m]', effort: 'high' });
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 1);
        const note = await writeNote(world, '2026-10-12-menu.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: `docs/handoff/2026-10-12-menu.md`');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const status = world.service.getStatus(world.chatId);
        assert.equal(status.state, 'done');
        assert.equal(status.enabled, true);
        const childId = status.childSessionId;
        assert.ok(childId);
        assert.equal(status.childTitle, 'Продолжение: Сайт кафе');
        const child = sessionsDb.getSessionById(childId);
        assert.equal(child.provider, 'claude');
        assert.equal(child.project_path, world.projectPath);
        assert.equal(child.model, 'sonnet[1m]');
        assert.equal(child.effort, 'high');
        const link = sessionLinksDb.getRow(childId);
        assert.deepEqual({ parent: link.parent_session_id, relation: link.relation }, { parent: world.chatId, relation: 'relay' });
        assert.equal(world.starts.length, 2);
        assert.deepEqual({ sessionId: world.starts[1].sessionId, parent: world.starts[1].parentSessionId, content: world.starts[1].content }, { sessionId: childId, parent: world.chatId, content: `Прочитай ${note} и продолжай работу с того места` });
        assert.equal(world.starts[1].options.model, 'sonnet[1m]');
        // The continuation inherits the switch, idle.
        assert.deepEqual({ enabled: world.service.getStatus(childId).enabled, state: world.service.getStatus(childId).state }, { enabled: true, state: null });
        assert.deepEqual(world.notices, [{
                kind: 'done', userId: world.member, provider: 'claude', sessionId: world.chatId, childSessionId: childId, childTitle: 'Продолжение: Сайт кафе',
            }]);
        assert.deepEqual(world.seen, [{ userId: world.member, sessionId: world.chatId }]);
        const lastFrame = world.frames.at(-1);
        assert.deepEqual({ kind: lastFrame.kind, sessionId: lastFrame.sessionId, state: lastFrame.status.state }, { kind: 'auto_relay', sessionId: world.chatId, state: 'done' });
        // Once per chat: later turn ends of the old chat do nothing.
        world.messages.set(world.chatId, [{ kind: 'text', role: 'user', content: 'ещё' }, { kind: 'text', role: 'assistant', content: 'ок' }]);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.starts.length, 2);
    });
});
test('the continuation moves only past its own threshold', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'a.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/a.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const childId = world.service.getStatus(world.chatId).childSessionId;
        world.messages.set(childId, [
            { kind: 'text', role: 'user', content: 'Прочитай записку' },
            { kind: 'text', role: 'assistant', content: 'Прочитал, продолжаю: корзина.' },
        ]);
        world.usage.set(childId, 30_000);
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 2, 'the fresh continuation stays put');
        world.usage.set(childId, 110_000);
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 3);
        assert.equal(world.starts[2].sessionId, childId);
        assert.equal(world.service.getStatus(childId).state, 'collecting');
    });
});
test('a continuation that starts heavy does not bounce: it must grow 10 points past its first turn', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'heavy.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/heavy.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const childId = world.service.getStatus(world.chatId).childSessionId;
        world.messages.set(childId, [
            { kind: 'text', role: 'user', content: 'Прочитай записку' },
            { kind: 'text', role: 'assistant', content: 'Прочитал.' },
        ]);
        world.usage.set(childId, 120_000); // 60% right after reading the note
        await world.service.handleAttentionChange(turnEnded(world, childId));
        world.usage.set(childId, 138_000); // 69%
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 2, 'still below its floor + 10 points');
        world.usage.set(childId, 140_000); // 70%
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 3);
        assert.equal(world.starts[2].sessionId, childId);
    });
});
test('Dima wrote after the handoff answer: back to idle, no continuation, no failure', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'race.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/race.md');
        world.messages.set(world.chatId, [
            ...(world.messages.get(world.chatId) ?? []),
            { kind: 'text', role: 'user', content: 'Подожди, сначала поправь цены' },
            { kind: 'text', role: 'assistant', content: 'Поправил цены.' },
        ]);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.service.getStatus(world.chatId).state, null);
        assert.equal(world.service.getStatus(world.chatId).enabled, true);
        assert.equal(sessionLinksDb.getChildren([world.chatId]).length, 0);
        assert.equal(world.starts.length, 1);
        assert.equal(world.notices.length, 0);
    });
});
test('Dima wrote while the note was being checked: nothing is created', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'race2.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/race2.md');
        // The first read finds the note; right after it Dima's message lands and his run starts.
        world.afterFetch.hook = (sessionId) => {
            if (sessionId !== world.chatId)
                return;
            world.messages.set(world.chatId, [
                ...(world.messages.get(world.chatId) ?? []),
                { kind: 'text', role: 'user', content: 'И добавь корзину' },
            ]);
            world.running.add(world.chatId);
            world.afterFetch.hook = null;
        };
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.service.getStatus(world.chatId).state, null);
        assert.equal(sessionLinksDb.getChildren([world.chatId]).length, 0);
        assert.equal(world.starts.length, 1);
    });
});
test('a note line answering another message of Dima does not count', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'later.md');
        world.messages.set(world.chatId, [
            ...(world.messages.get(world.chatId) ?? []),
            { kind: 'text', role: 'user', content: world.starts[0].content },
            { kind: 'text', role: 'assistant', content: 'Сейчас.' },
            { kind: 'text', role: 'user', content: 'А что в docs/handoff/later.md?' },
            { kind: 'text', role: 'assistant', content: 'Там записка.\nHANDOFF_FILE: docs/handoff/later.md' },
        ]);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(sessionLinksDb.getChildren([world.chatId]).length, 0);
        assert.equal(world.starts.length, 1);
    });
});
test('a failure is told once even when the restart and the end of the turn race', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const ended = world.service.handleAttentionChange(turnEnded(world, world.chatId, 'failed', 'interrupted'));
        const reconciled = Promise.resolve().then(() => world.service.reconcileOnBoot());
        await Promise.all([ended, reconciled]);
        assert.equal(world.service.getStatus(world.chatId).state, 'failed');
        assert.equal(world.notices.length, 1);
        assert.equal(world.service.reconcileOnBoot(), 0);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.notices.length, 1);
    });
});
test('the handoff turn has 10 minutes; then a clear error and nothing is created later', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.timers.length, 1);
        assert.equal(world.timers[0].ms, 600_000);
        world.timers[0].fire();
        const status = world.service.getStatus(world.chatId);
        assert.equal(status.state, 'failed');
        assert.equal(status.enabled, false);
        assert.match(status.error ?? '', /10 минут/);
        assert.equal(world.notices.length, 1);
        await writeNote(world, 'late.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/late.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(sessionLinksDb.getChildren([world.chatId]).length, 0);
        assert.equal(world.notices.length, 1);
    });
});
test('a finished handoff turn cancels its timeout', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'quick.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/quick.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.service.getStatus(world.chatId).state, 'done');
        assert.equal(world.timers[0].cancelled, true);
    });
});
test('an unknown spend never becomes the continuation floor', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        await writeNote(world, 'unknown.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/unknown.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const childId = world.service.getStatus(world.chatId).childSessionId;
        world.messages.set(childId, [
            { kind: 'text', role: 'user', content: 'Прочитай записку' },
            { kind: 'text', role: 'assistant', content: 'Прочитал.' },
        ]);
        // First turn: spend unknown — nothing is stored, nothing moves.
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(sessionAutoRelayDb.get(childId)?.baseline_json ?? null, null);
        world.usage.set(childId, 120_000); // first known spend, 60%: this is the floor
        await world.service.handleAttentionChange(turnEnded(world, childId));
        world.usage.set(childId, 138_000);
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 2, 'below floor + 10 points');
        world.usage.set(childId, 140_000);
        await world.service.handleAttentionChange(turnEnded(world, childId));
        assert.equal(world.starts.length, 3);
    });
});
test('no note: told once, the switch goes off, nothing is created', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        world.messages.set(world.chatId, [
            ...(world.messages.get(world.chatId) ?? []),
            { kind: 'text', role: 'user', content: world.starts[0].content },
            { kind: 'text', role: 'assistant', content: 'Не понял, что именно собрать.' },
        ]);
        // Paused on an approval mid-run: not a failure yet.
        await world.service.handleAttentionChange(turnEnded(world, world.chatId, 'waiting', 'permission'));
        assert.equal(world.service.getStatus(world.chatId).state, 'collecting');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        const status = world.service.getStatus(world.chatId);
        assert.equal(status.state, 'failed');
        assert.equal(status.enabled, false);
        assert.match(status.error ?? '', /HANDOFF_FILE/);
        assert.equal(world.notices.length, 1);
        assert.equal(world.notices[0].kind, 'failed');
        assert.equal(sessionLinksDb.getChildren([world.chatId]).length, 0);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.notices.length, 1, 'told once');
        assert.equal(world.starts.length, 1);
        // Switching it on again starts over.
        world.service.setEnabled(world.chatId, true, world.member);
        assert.deepEqual({ state: world.service.getStatus(world.chatId).state, error: world.service.getStatus(world.chatId).error }, { state: null, error: null });
    });
});
test('a note outside the project is refused like a missing one', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: /etc/hosts');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.service.getStatus(world.chatId).state, 'failed');
        assert.match(world.service.getStatus(world.chatId).error ?? '', /вне проекта/);
        assert.equal(world.starts.length, 1);
    });
});
test('switched off while the note was written: the turn ends and nothing more happens', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        world.service.setEnabled(world.chatId, false, world.member);
        await writeNote(world, 'b.md');
        agentWroteNote(world, world.chatId, 'HANDOFF_FILE: docs/handoff/b.md');
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.deepEqual({ state: world.service.getStatus(world.chatId).state, enabled: world.service.getStatus(world.chatId).enabled }, { state: null, enabled: false });
        assert.equal(world.starts.length, 1);
        assert.equal(world.notices.length, 0);
    });
});
test('a move cut short by a restart is told once and switched off', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        await world.service.handleAttentionChange(turnEnded(world, world.chatId));
        assert.equal(world.service.reconcileOnBoot(), 1);
        assert.equal(world.service.getStatus(world.chatId).state, 'failed');
        assert.equal(world.service.getStatus(world.chatId).enabled, false);
        assert.equal(world.notices.length, 1);
        assert.equal(world.service.reconcileOnBoot(), 0);
    });
});
test('new chats follow the user default; a relay continuation inherits the parent switch', async () => {
    await withWorld(async (world) => {
        sessionsDb.createAppSession('fresh', 'claude', world.projectPath);
        world.service.applyNewChatDefaults({ sessionId: 'fresh', userId: world.member });
        assert.equal(world.service.getStatus('fresh').enabled, true);
    }, { newChatsDefault: true });
    await withWorld(async (world) => {
        sessionsDb.createAppSession('plain', 'claude', world.projectPath);
        world.service.applyNewChatDefaults({ sessionId: 'plain', userId: world.member });
        assert.equal(world.service.getStatus('plain').enabled, false);
        arm(world);
        sessionsDb.createAppSession('manual-continuation', 'claude', world.projectPath);
        world.service.applyNewChatDefaults({ sessionId: 'manual-continuation', userId: world.member, parentSessionId: world.chatId, relation: 'relay' });
        assert.equal(world.service.getStatus('manual-continuation').enabled, true);
        assert.equal(sessionAutoRelayDb.get('manual-continuation')?.state ?? null, null);
    });
});
test('a user without access to the chat never triggers a move', async () => {
    await withWorld(async (world) => {
        arm(world);
        world.usage.set(world.chatId, 120_000);
        world.running.delete(world.chatId);
        world.attention.set(world.chatId, { state: 'done' });
        sessionAutoRelayDb.upsert(world.chatId, { user_id: world.outsider }, 'now');
        await world.service.handleAttentionChange({ sessionId: world.chatId, userId: world.outsider, state: 'done' });
        assert.equal(world.starts.length, 0);
    });
});
test('the live-check hook lowers only the token threshold, and only with a positive number', () => {
    assert.deepEqual(thresholdsFromEnv({}), { contextPercent: 50, contextTokens: 400_000, ageHours: 12 });
    assert.deepEqual(thresholdsFromEnv({ NEO3_AUTO_RELAY_TOKENS: '3000' }), { contextPercent: 50, contextTokens: 3000, ageHours: 12 });
    assert.deepEqual(thresholdsFromEnv({ NEO3_AUTO_RELAY_TOKENS: 'abc' }), { contextPercent: 50, contextTokens: 400_000, ageHours: 12 });
});
//# sourceMappingURL=auto-relay.service.test.js.map