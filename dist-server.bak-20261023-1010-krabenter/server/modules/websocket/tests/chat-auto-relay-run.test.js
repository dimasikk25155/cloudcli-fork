import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionLinksDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { clearRunOptions, lastRunOptions } from '../../../modules/auto-relay/index.js';
import { chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { createAutoRelayRunControl, createThreadRunControl } from '../../../modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '../../../modules/websocket/services/websocket-state.service.js';
import { isServiceTurn } from '../../../shared/service-turns.js';
async function withWorld(runTest) {
    const previous = process.env.DATABASE_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'chat-auto-relay-run-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
        const owner = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
        const outsider = Number(userDb.createUserWithRole('guest', 'x', 'user').id);
        const project = projectsDb.createProjectPath('/workspace/auto-relay-run').project;
        userProjectAccessDb.grantAccess(owner, project.project_id, admin);
        sessionsDb.createAppSession('chat', 'claude', project.project_path);
        sessionsDb.createAppSession('continuation', 'claude', project.project_path);
        sessionsDb.createAppSession('thread', 'claude', project.project_path);
        sessionsDb.createAppSession('unrelated', 'claude', project.project_path);
        sessionLinksDb.setParent('continuation', 'chat', 'relay');
        sessionLinksDb.setParent('thread', 'chat', 'thread');
        await runTest({ owner, outsider });
    }
    finally {
        connectedClients.clear();
        chatRunRegistry.clearAll();
        clearRunOptions();
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(directory, { recursive: true, force: true });
    }
}
function fakeDependencies(backgroundTasks = []) {
    const spawns = [];
    const dependencies = {
        // Fake project folders: the jail has its own tests (chat-user-jail.test.ts).
        userJailFor: () => null,
        spawnFns: {
            claude: async (command, options) => {
                spawns.push({ command, options });
                await new Promise(() => { });
            },
        },
        abortFns: {},
        backgroundTasksFns: { claude: () => backgroundTasks },
        resolveToolApproval: () => { },
        getPendingApprovalsForSession: () => [],
    };
    return { dependencies, spawns };
}
test('the handoff request runs in the chat itself as its user and is registered', async () => {
    await withWorld(({ owner }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createAutoRelayRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'chat', userId: owner, parentSessionId: 'chat', content: 'Собери записку', options: { model: 'opus[1m]' } }), true);
        assert.equal(chatRunRegistry.isProcessing('chat'), true);
        assert.equal(spawns.length, 1);
        assert.match(spawns[0].command, /Собери записку/);
        assert.equal(spawns[0].options.model, 'opus[1m]');
    });
});
test('the relay continuation of that chat may be started', async () => {
    await withWorld(({ owner }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createAutoRelayRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'continuation', userId: owner, parentSessionId: 'chat', content: 'Прочитай записку', options: {} }), true);
        assert.equal(spawns.length, 1);
    });
});
test('a thread, an unrelated chat or a user without access is refused', async () => {
    await withWorld(({ owner, outsider }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createAutoRelayRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'thread', userId: owner, parentSessionId: 'chat', content: 'x', options: {} }), false);
        assert.equal(control.start({ sessionId: 'unrelated', userId: owner, parentSessionId: 'chat', content: 'x', options: {} }), false);
        assert.equal(control.start({ sessionId: 'chat', userId: outsider, parentSessionId: 'chat', content: 'x', options: {} }), false);
        assert.equal(spawns.length, 0);
    });
});
test('a server-started run does not overwrite the options a person typed with', async () => {
    await withWorld(({ owner }) => {
        const { dependencies } = fakeDependencies();
        const control = createAutoRelayRunControl(dependencies);
        control.start({ sessionId: 'chat', userId: owner, parentSessionId: 'chat', content: 'x', options: { model: 'fable' } });
        assert.equal(lastRunOptions('chat'), null);
    });
});
test('background tasks of the chat are counted through the engine lookup', async () => {
    await withWorld(() => {
        sessionsDb.assignProviderSessionId('chat', 'provider-chat');
        const busy = createAutoRelayRunControl(fakeDependencies([{ taskId: 't1' }, { taskId: 't2' }]).dependencies);
        assert.equal(busy.backgroundTaskCount('chat'), 2);
        const idle = createAutoRelayRunControl(fakeDependencies([]).dependencies);
        assert.equal(idle.backgroundTaskCount('chat'), 0);
        // No provider id yet → nothing can run in the background.
        assert.equal(busy.backgroundTaskCount('unrelated'), 0);
    });
});
test('only the handoff request is a service turn and may write its note into docs/handoff', async () => {
    await withWorld(({ owner }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createAutoRelayRunControl(dependencies);
        control.start({ sessionId: 'chat', userId: owner, parentSessionId: 'chat', content: 'Переносим работу в новый чат (эстафета ab12).\nСобери записку', options: { autoRelayNoteDir: '/etc' } });
        assert.equal(spawns[0].options.autoRelayNoteDir, '/workspace/auto-relay-run/docs/handoff');
        assert.equal(isServiceTurn('chat'), true);
        control.start({ sessionId: 'continuation', userId: owner, parentSessionId: 'chat', content: 'Прочитай записку и продолжай', options: {} });
        assert.equal(spawns[1].options.autoRelayNoteDir, undefined);
        assert.equal(isServiceTurn('continuation'), false);
    });
});
test('no other kind of run can claim the note folder through its options', async () => {
    await withWorld(({ owner }) => {
        sessionLinksDb.setParent('unrelated', 'chat', 'thread');
        const { dependencies, spawns } = fakeDependencies();
        createThreadRunControl(dependencies).start({
            sessionId: 'unrelated', userId: owner, parentSessionId: 'chat',
            content: 'Переносим работу в новый чат (эстафета ab12).', options: { autoRelayNoteDir: '/etc' },
        });
        assert.equal(spawns.length, 1);
        assert.equal(spawns[0].options.autoRelayNoteDir, undefined);
        assert.equal(isServiceTurn('unrelated'), false);
    });
});
//# sourceMappingURL=chat-auto-relay-run.test.js.map