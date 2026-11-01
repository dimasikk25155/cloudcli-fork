import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb } from '../../../modules/database/index.js';
import { handleChatConnection } from '../../../modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '../../../modules/websocket/services/websocket-state.service.js';
import { jailSupported } from '../../../shared/user-jail.js';
class FakeSocket extends EventEmitter {
    readyState = 1;
    frames = [];
    send(data) {
        this.frames.push(JSON.parse(data));
    }
    async deliver(payload) {
        this.emit('message', Buffer.from(JSON.stringify(payload)));
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
function dependencies(spawns) {
    const record = (provider) => async (_command, options) => {
        spawns.push({ provider, options });
    };
    return {
        spawnFns: { claude: record('claude'), grok: record('grok'), cursor: record('cursor') },
        abortFns: {},
        resolveToolApproval: () => { },
        getPendingApprovalsForSession: () => [],
        isModOn: () => false,
    };
}
test('chat.send: a teammate runs fenced to the project, Dima runs free', { skip: !jailSupported() }, async (t) => {
    const tempDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'chat-user-jail-')));
    const previousDatabasePath = process.env.DATABASE_PATH;
    const previousSwitch = process.env.NEO3_USER_JAIL;
    t.after(async () => {
        connectedClients.clear();
        chatRunRegistry.clearAll();
        closeConnection();
        if (previousDatabasePath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousDatabasePath;
        if (previousSwitch === undefined)
            delete process.env.NEO3_USER_JAIL;
        else
            process.env.NEO3_USER_JAIL = previousSwitch;
        await rm(tempDirectory, { recursive: true, force: true });
    });
    delete process.env.NEO3_USER_JAIL;
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const slavik = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const project = path.join(tempDirectory, 'difinance');
    await mkdir(project);
    const claudeChat = sessionsDb.createSession('c-1', 'claude', project, 'чат');
    const cursorChat = sessionsDb.createSession('c-2', 'cursor', project, 'курсор');
    const gone = path.join(tempDirectory, 'gone');
    const goneChat = sessionsDb.createSession('c-3', 'claude', gone, 'папки нет');
    for (const dir of [project, gone]) {
        userProjectAccessDb.grantAccess(slavik, projectsDb.getProjectPath(dir).project_id, admin);
    }
    const spawns = [];
    const teammate = new FakeSocket();
    handleChatConnection(teammate, { user: { userId: slavik } }, dependencies(spawns));
    // A client cannot switch the fence off by sending its own `jail`.
    await teammate.deliver({ type: 'chat.send', sessionId: claudeChat, content: 'привет', options: { jail: null, cwd: '/' } });
    assert.equal(spawns.length, 1);
    assert.deepEqual(spawns[0].options.jail, { root: project, userId: slavik, readFiles: [] });
    assert.equal(spawns[0].options.cwd, project);
    await teammate.deliver({ type: 'chat.send', sessionId: cursorChat, content: 'курсор' });
    assert.equal(teammate.frames.find((frame) => frame.code === 'PROJECT_JAIL_PROVIDER')?.kind, 'protocol_error');
    await teammate.deliver({ type: 'chat.send', sessionId: goneChat, content: 'нет папки' });
    assert.equal(teammate.frames.find((frame) => frame.code === 'PROJECT_JAIL_DENIED')?.kind, 'protocol_error');
    assert.equal(spawns.length, 1);
    chatRunRegistry.clearAll();
    const dima = new FakeSocket();
    handleChatConnection(dima, { user: { userId: admin } }, dependencies(spawns));
    await dima.deliver({ type: 'chat.send', sessionId: cursorChat, content: 'я' });
    assert.equal(spawns.length, 2);
    assert.equal(spawns[1].options.jail, undefined);
});
//# sourceMappingURL=chat-user-jail.test.js.map