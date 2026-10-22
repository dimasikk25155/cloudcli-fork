import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeDatabase, closeConnection, projectsDb, sessionsDb, userDb, userProjectAccessDb } from '../../../modules/database/index.js';
import { broadcastProjectEvent, canAccessSession, clientIdentities } from '../services/project-access.service.js';
import { connectedClients } from '../services/websocket-state.service.js';
class Client extends EventEmitter {
    readyState = 1;
    frames = [];
    send(payload) { this.frames.push(payload); }
}
test('realtime project updates and session access respect grants, revocation and active users', async () => {
    const previousPath = process.env.DATABASE_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'neo3-project-access-'));
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    closeConnection();
    await initializeDatabase();
    try {
        const admin = userDb.createUserWithRole('owner', 'unused', 'admin');
        const team = userDb.createUserWithRole('team', 'unused', 'user');
        const other = userDb.createUserWithRole('other', 'unused', 'user');
        const assigned = projectsDb.createProjectPath('/workspace/assigned').project;
        const foreign = projectsDb.createProjectPath('/workspace/foreign').project;
        sessionsDb.createAppSession('assigned-session', 'codex', assigned.project_path);
        sessionsDb.createAppSession('foreign-session', 'codex', foreign.project_path);
        userProjectAccessDb.grantAccess(Number(team.id), assigned.project_id, Number(admin.id));
        const ownerSocket = new Client(), teamSocket = new Client(), otherSocket = new Client(), unknown = new Client();
        for (const [socket, user] of [[ownerSocket, admin], [teamSocket, team], [otherSocket, other]]) {
            clientIdentities.set(socket, { id: Number(user.id), role: user.role });
            connectedClients.add(socket);
        }
        connectedClients.add(unknown);
        broadcastProjectEvent('assigned-update', assigned.project_id);
        broadcastProjectEvent('foreign-update', foreign.project_id);
        broadcastProjectEvent('unindexed-update', null);
        assert.deepEqual(teamSocket.frames, ['assigned-update']);
        assert.deepEqual(ownerSocket.frames, ['assigned-update', 'foreign-update', 'unindexed-update']);
        assert.deepEqual(otherSocket.frames, []);
        assert.deepEqual(unknown.frames, []);
        assert.equal(canAccessSession({ id: Number(team.id), role: 'admin' }, 'foreign-session'), false, 'client role cannot elevate database role');
        assert.equal(canAccessSession({ id: Number(team.id) }, 'assigned-session'), true);
        const { handleChatConnection } = await import('../services/chat-websocket.service.js');
        const subscriber = new Client();
        handleChatConnection(subscriber, { user: { id: Number(team.id), role: 'user' } }, {});
        subscriber.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: 'foreign-session' }, { sessionId: 'assigned-session' }] }));
        const subscriptionFrames = subscriber.frames.map(frame => JSON.parse(frame));
        assert.ok(subscriptionFrames.some(frame => frame.kind === 'protocol_error' && frame.code === 'PROJECT_ACCESS_DENIED' && frame.sessionId === 'foreign-session'));
        assert.ok(subscriptionFrames.some(frame => frame.kind === 'chat_subscribed' && frame.sessionId === 'assigned-session'));
        assert.ok(!subscriptionFrames.some(frame => frame.kind === 'chat_subscribed' && frame.sessionId === 'foreign-session'));
        subscriber.emit('close');
        // Exercise the actual REST router: guessed session IDs cannot read or mutate foreign sessions.
        const { default: providerRouter } = await import('../../../modules/providers/provider.routes.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { Object.assign(req, { user: { id: Number(team.id), role: 'user' } }); next(); });
        app.use('/api/providers', providerRouter);
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        const base = `http://127.0.0.1:${address.port}/api/providers`;
        try {
            for (const [method, suffix] of [['GET', '/messages'], ['DELETE', ''], ['PUT', ''], ['POST', '/restore']]) {
                const response = await fetch(`${base}/sessions/foreign-session${suffix}`, { method });
                assert.equal(response.status, 403, `${method} foreign session must be denied`);
            }
            assert.equal((await fetch(`${base}/sessions/assigned-session/messages`)).status, 200);
            const creation = await fetch(`${base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', projectPath: foreign.project_path }) });
            assert.equal(creation.status, 403);
            assert.ok(sessionsDb.getSessionById('foreign-session'), 'denied mutations preserved the foreign session');
        }
        finally {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        userProjectAccessDb.revokeAccess(Number(team.id), assigned.project_id);
        broadcastProjectEvent('revoked-update', assigned.project_id);
        assert.deepEqual(teamSocket.frames, ['assigned-update']);
        assert.equal(canAccessSession({ id: Number(team.id) }, 'assigned-session'), false);
        userDb.setUserActive(Number(admin.id), false);
        broadcastProjectEvent('disabled-update', foreign.project_id);
        assert.equal(ownerSocket.frames.length, 4);
    }
    finally {
        connectedClients.clear();
        closeConnection();
        if (previousPath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousPath;
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=project-access.test.js.map