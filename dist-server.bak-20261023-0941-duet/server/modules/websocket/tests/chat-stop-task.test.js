import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '../../../modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '../../../modules/websocket/services/websocket-state.service.js';
async function withIsolatedDatabase(runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-stop-task-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = userDb.createUserWithRole('dima', 'x', 'admin');
        const employee = userDb.createUserWithRole('slavik', 'x', 'user');
        const sessionId = sessionsDb.createSession('claude-native-1', 'claude', '/workspace/alpha', 'Деплой с фоном');
        const projectId = projectsDb.getProjectPath('/workspace/alpha').project_id;
        await runTest({ adminId: Number(admin.id), employeeId: Number(employee.id), sessionId, projectId });
    }
    finally {
        connectedClients.clear();
        chatRunRegistry.clearAll();
        closeConnection();
        if (previousDatabasePath === undefined) {
            delete process.env.DATABASE_PATH;
        }
        else {
            process.env.DATABASE_PATH = previousDatabasePath;
        }
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
class FakeSocket extends EventEmitter {
    readyState = 1;
    frames = [];
    send(data) {
        this.frames.push(JSON.parse(data));
    }
    async deliver(payload) {
        this.emit('message', Buffer.from(JSON.stringify(payload)));
        for (let i = 0; i < 5; i += 1) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }
}
function fakeDependencies(answer = { ok: true }, modsOff = new Set()) {
    const stops = [];
    const dependencies = {
        spawnFns: {},
        abortFns: {},
        stopTaskFns: {
            claude: async (providerSessionId, taskId) => {
                stops.push({ providerSessionId, taskId });
                return answer;
            },
        },
        backgroundTasksFns: {
            claude: (providerSessionId) => (providerSessionId === 'claude-native-1'
                ? [{ taskId: 'b1', kind: 'bash', description: 'npm run dev', startedAt: 1_000 }]
                : []),
        },
        resolveToolApproval: () => { },
        getPendingApprovalsForSession: () => [],
        isModOn: (_userId, key) => !modsOff.has(key),
    };
    return { dependencies, stops };
}
function startClaudeRun(fixture, socket) {
    chatRunRegistry.startRun({
        appSessionId: fixture.sessionId,
        provider: 'claude',
        providerSessionId: 'claude-native-1',
        connection: socket,
        userId: fixture.adminId,
        projectId: fixture.projectId,
    });
}
function stopReply(socket) {
    return socket.frames.find((frame) => frame.kind === 'background_task_stop');
}
test('stopping a background task of a session in a project the user cannot access is refused', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies, stops } = fakeDependencies();
        const socket = new FakeSocket();
        startClaudeRun(fixture, socket);
        handleChatConnection(socket, { user: { userId: fixture.employeeId, role: 'user' } }, dependencies);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'b1' });
        assert.equal(stops.length, 0, 'a stranger must not reach the runtime');
        const denial = socket.frames.find((frame) => frame.kind === 'protocol_error');
        assert.equal(denial?.code, 'PROJECT_ACCESS_DENIED');
        userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'b1' });
        assert.deepEqual(stops, [{ providerSessionId: 'claude-native-1', taskId: 'b1' }]);
    });
});
test('the owner stops one task: the runtime gets the native session id and the task, the client gets ok', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies, stops } = fakeDependencies({ ok: true });
        const socket = new FakeSocket();
        startClaudeRun(fixture, socket);
        handleChatConnection(socket, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'agent-7' });
        assert.deepEqual(stops, [{ providerSessionId: 'claude-native-1', taskId: 'agent-7' }]);
        const reply = stopReply(socket);
        assert.equal(reply?.ok, true);
        assert.equal(reply?.sessionId, fixture.sessionId);
        assert.equal(reply?.taskId, 'agent-7');
    });
});
test('no live run for the session: the client is told the turn is over', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies, stops } = fakeDependencies();
        const socket = new FakeSocket();
        // No run started: the turn has ended and the CLI process is gone.
        handleChatConnection(socket, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'b1' });
        assert.equal(stops.length, 0);
        const reply = stopReply(socket);
        assert.equal(reply?.ok, false);
        assert.equal(reply?.reason, 'turn_ended');
    });
});
test('the runtime no longer has the task: its answer reaches the client', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies } = fakeDependencies({ ok: false, reason: 'not_running' });
        const socket = new FakeSocket();
        startClaudeRun(fixture, socket);
        handleChatConnection(socket, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'gone' });
        const reply = stopReply(socket);
        assert.equal(reply?.ok, false);
        assert.equal(reply?.reason, 'not_running');
    });
});
test('a request without a task id is a protocol error', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies, stops } = fakeDependencies();
        const socket = new FakeSocket();
        startClaudeRun(fixture, socket);
        handleChatConnection(socket, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await socket.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId });
        assert.equal(stops.length, 0);
        assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'TASK_ID_REQUIRED');
    });
});
test('subscribing to a live run delivers its current background tasks right away', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies } = fakeDependencies();
        const runSocket = new FakeSocket();
        startClaudeRun(fixture, runSocket);
        const viewer = new FakeSocket();
        handleChatConnection(viewer, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await viewer.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: fixture.sessionId, lastSeq: 0 }] });
        const frame = viewer.frames.find((candidate) => candidate.kind === 'background_tasks');
        assert.equal(frame?.sessionId, fixture.sessionId);
        assert.deepEqual(frame?.tasks, [{ taskId: 'b1', kind: 'bash', description: 'npm run dev', startedAt: 1_000 }]);
    });
});
test('subscribing to a session with no live run sends no background list', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies } = fakeDependencies();
        const viewer = new FakeSocket();
        handleChatConnection(viewer, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await viewer.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: fixture.sessionId, lastSeq: 0 }] });
        assert.equal(viewer.frames.some((candidate) => candidate.kind === 'background_tasks'), false);
    });
});
test('«Пульт фона» switched off: no background list on subscribe, and a stop request does not reach the runtime', async () => {
    await withIsolatedDatabase(async (fixture) => {
        const { dependencies, stops } = fakeDependencies({ ok: true }, new Set(['modBackgroundConsole']));
        const runSocket = new FakeSocket();
        startClaudeRun(fixture, runSocket);
        const viewer = new FakeSocket();
        handleChatConnection(viewer, { user: { userId: fixture.adminId, role: 'admin' } }, dependencies);
        await viewer.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: fixture.sessionId, lastSeq: 0 }] });
        assert.equal(viewer.frames.some((frame) => frame.kind === 'background_tasks'), false);
        assert.equal(viewer.frames.find((frame) => frame.kind === 'chat_subscribed')?.isProcessing, true);
        await viewer.deliver({ type: 'chat.stop-task', sessionId: fixture.sessionId, taskId: 'b1' });
        assert.equal(stops.length, 0);
        const reply = stopReply(viewer);
        assert.equal(reply?.ok, false);
        assert.equal(reply?.reason, 'MOD_OFF');
    });
});
//# sourceMappingURL=chat-stop-task.test.js.map