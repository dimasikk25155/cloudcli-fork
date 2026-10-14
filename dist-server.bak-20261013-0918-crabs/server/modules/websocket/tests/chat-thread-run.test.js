import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionLinksDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { threadTokens } from '../../../modules/threads/index.js';
import { chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { createThreadRunControl } from '../../../modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '../../../modules/websocket/services/websocket-state.service.js';
async function withWorld(runTest) {
    const previous = process.env.DATABASE_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'chat-thread-run-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
        const owner = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
        const outsider = Number(userDb.createUserWithRole('guest', 'x', 'user').id);
        const project = projectsDb.createProjectPath('/workspace/thread-run').project;
        userProjectAccessDb.grantAccess(owner, project.project_id, admin);
        sessionsDb.createAppSession('parent', 'claude', project.project_path);
        sessionsDb.createAppSession('thread', 'grok', project.project_path);
        sessionsDb.createAppSession('unrelated', 'grok', project.project_path);
        sessionLinksDb.setParent('thread', 'parent', 'thread');
        await runTest({ owner, outsider, projectPath: project.project_path });
    }
    finally {
        connectedClients.clear();
        chatRunRegistry.clearAll();
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(directory, { recursive: true, force: true });
    }
}
function fakeDependencies() {
    const spawns = [];
    const aborted = [];
    const dependencies = {
        spawnFns: {
            grok: async (command, options) => {
                spawns.push({ command, options });
                await new Promise(() => { });
            },
            claude: async (command, options) => {
                spawns.push({ command, options });
                await new Promise(() => { });
            },
        },
        abortFns: {
            grok: (providerSessionId) => { aborted.push(providerSessionId); return true; },
        },
        resolveToolApproval: () => { },
        getPendingApprovalsForSession: () => [],
    };
    return { dependencies, spawns, aborted };
}
test('a thread run starts as the parent user, is registered, and carries its own thread token', async () => {
    await withWorld(({ owner }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createThreadRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'thread', userId: owner, parentSessionId: 'parent', content: 'Проверь тесты', options: { model: 'grok-4.7-build-fast' } }), true);
        assert.equal(chatRunRegistry.isProcessing('thread'), true);
        assert.equal(spawns.length, 1);
        assert.match(spawns[0].command, /Проверь тесты/);
        assert.equal(spawns[0].options.model, 'grok-4.7-build-fast');
        const env = spawns[0].options.threadsEnv;
        assert.match(env.NEO3_THREADS_API_URL, /^http:\/\/[^/]+:\d+\/api\/threads$/);
        assert.deepEqual(threadTokens.resolve(env.NEO3_THREADS_TOKEN), { sessionId: 'thread', userId: owner, permissionMode: null });
    });
});
test('the parent itself may be started («Треды готовы»), a busy chat may not', async () => {
    await withWorld(({ owner }) => {
        const { dependencies } = fakeDependencies();
        const control = createThreadRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'Треды готовы', options: {} }), true);
        assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'ещё раз', options: {} }), false);
    });
});
test('a chat that is not a thread of that parent, or a user without access, is refused', async () => {
    await withWorld(({ owner, outsider }) => {
        const { dependencies, spawns } = fakeDependencies();
        const control = createThreadRunControl(dependencies);
        assert.equal(control.start({ sessionId: 'unrelated', userId: owner, parentSessionId: 'parent', content: 'x', options: {} }), false);
        assert.equal(control.start({ sessionId: 'thread', userId: outsider, parentSessionId: 'parent', content: 'x', options: {} }), false);
        assert.equal(spawns.length, 0);
        assert.equal(chatRunRegistry.isProcessing('unrelated'), false);
    });
});
test('abort stops a running thread like the Stop button and reports an idle one', async () => {
    await withWorld(async ({ owner }) => {
        const { dependencies } = fakeDependencies();
        const control = createThreadRunControl(dependencies);
        control.start({ sessionId: 'thread', userId: owner, parentSessionId: 'parent', content: 'x', options: {} });
        assert.equal(await control.abort('thread', owner), true);
        assert.equal(chatRunRegistry.isProcessing('thread'), false);
        assert.equal(await control.abort('thread', owner), false);
    });
});
//# sourceMappingURL=chat-thread-run.test.js.map