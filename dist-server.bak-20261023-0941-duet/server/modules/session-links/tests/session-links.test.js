import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb, } from '../../../modules/database/index.js';
import { getSessionLinks, linkSession } from '../../../modules/session-links/index.js';
/**
 * Throwaway database with an admin, a member granted projects A and B (not
 * the foreign one) and three project paths.
 */
async function withWorld(runTest) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const directory = await mkdtemp(path.join(tmpdir(), 'session-links-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(directory, 'auth.db');
    await initializeDatabase();
    try {
        const admin = userDb.createUserWithRole('owner', 'unused', 'admin');
        const member = userDb.createUserWithRole('member', 'unused', 'user');
        const projectA = projectsDb.createProjectPath('/workspace/links-a').project;
        const projectB = projectsDb.createProjectPath('/workspace/links-b').project;
        const foreign = projectsDb.createProjectPath('/workspace/links-foreign').project;
        userProjectAccessDb.grantAccess(Number(member.id), projectA.project_id, Number(admin.id));
        userProjectAccessDb.grantAccess(Number(member.id), projectB.project_id, Number(admin.id));
        await runTest({
            admin: { id: Number(admin.id) },
            member: { id: Number(member.id) },
            projectA: projectA.project_path,
            projectB: projectB.project_path,
            foreignProject: foreign.project_path,
        });
    }
    finally {
        closeConnection();
        if (previousDatabasePath === undefined) {
            delete process.env.DATABASE_PATH;
        }
        else {
            process.env.DATABASE_PATH = previousDatabasePath;
        }
        await rm(directory, { recursive: true, force: true });
    }
}
test('a linked child shows its parent, and the parent lists the child', async () => {
    await withWorld(({ member, projectA }) => {
        sessionsDb.createAppSession('parent-1', 'claude', projectA);
        sessionsDb.updateSessionCustomName('parent-1', 'Длинный чат');
        sessionsDb.createAppSession('child-1', 'grok', projectA);
        linkSession({ childSessionId: 'child-1', parentSessionId: 'parent-1', relation: 'relay', user: member });
        const childLinks = getSessionLinks('child-1', member);
        assert.equal(childLinks.parent?.sessionId, 'parent-1');
        assert.equal(childLinks.parent?.relation, 'relay');
        assert.equal(childLinks.parent?.name, 'Длинный чат');
        assert.equal(childLinks.parent?.provider, 'claude');
        assert.deepEqual(childLinks.children, []);
        const parentLinks = getSessionLinks('parent-1', member);
        assert.equal(parentLinks.parent, undefined);
        assert.deepEqual(parentLinks.children.map((child) => [child.sessionId, child.relation, child.provider]), [['child-1', 'relay', 'grok']]);
    });
});
test('linking is refused for a foreign, missing or other-project parent, and nothing is stored', async () => {
    await withWorld(({ member, projectA, projectB, foreignProject }) => {
        sessionsDb.createAppSession('child-2', 'claude', projectA);
        sessionsDb.createAppSession('foreign-parent', 'claude', foreignProject);
        sessionsDb.createAppSession('other-project-parent', 'claude', projectB);
        const attempts = [
            ['foreign-parent', 'PARENT_SESSION_ACCESS_DENIED', 403],
            ['no-such-session', 'PARENT_SESSION_NOT_FOUND', 404],
            ['other-project-parent', 'SESSION_LINK_OTHER_PROJECT', 400],
        ];
        for (const [parentSessionId, code, statusCode] of attempts) {
            assert.throws(() => linkSession({ childSessionId: 'child-2', parentSessionId, relation: 'thread', user: member }), { code, statusCode }, `parent ${parentSessionId}`);
        }
        assert.deepEqual(getSessionLinks('child-2', member), { children: [] });
        assert.deepEqual(getSessionLinks('other-project-parent', member), { children: [] });
    });
});
test('linking is refused for an unknown relation, a loop and a second parent', async () => {
    await withWorld(({ admin, projectA }) => {
        sessionsDb.createAppSession('root', 'claude', projectA);
        sessionsDb.createAppSession('middle', 'claude', projectA);
        sessionsDb.createAppSession('another-parent', 'claude', projectA);
        assert.throws(() => linkSession({ childSessionId: 'middle', parentSessionId: 'root', relation: 'fork', user: admin }), { code: 'SESSION_LINK_INVALID_RELATION', statusCode: 400 });
        assert.throws(() => linkSession({ childSessionId: 'root', parentSessionId: 'root', relation: 'relay', user: admin }), { code: 'SESSION_LINK_CYCLE', statusCode: 400 });
        linkSession({ childSessionId: 'middle', parentSessionId: 'root', relation: 'relay', user: admin });
        // Same link again is fine; a different parent is not.
        linkSession({ childSessionId: 'middle', parentSessionId: 'root', relation: 'relay', user: admin });
        assert.throws(() => linkSession({ childSessionId: 'middle', parentSessionId: 'another-parent', relation: 'relay', user: admin }), { code: 'SESSION_LINK_ALREADY_LINKED', statusCode: 409 });
        assert.throws(() => linkSession({ childSessionId: 'root', parentSessionId: 'middle', relation: 'thread', user: admin }), { code: 'SESSION_LINK_CYCLE', statusCode: 400 });
        assert.equal(getSessionLinks('middle', admin).parent?.sessionId, 'root');
        assert.equal(getSessionLinks('root', admin).parent, undefined);
        assert.deepEqual(getSessionLinks('another-parent', admin).children, []);
    });
});
test('a user who cannot see the child cannot link it or read its links', async () => {
    await withWorld(({ admin, member, foreignProject }) => {
        sessionsDb.createAppSession('foreign-parent-2', 'claude', foreignProject);
        sessionsDb.createAppSession('foreign-child', 'claude', foreignProject);
        assert.throws(() => linkSession({ childSessionId: 'foreign-child', parentSessionId: 'foreign-parent-2', relation: 'thread', user: member }), { code: 'SESSION_ACCESS_DENIED', statusCode: 403 });
        linkSession({ childSessionId: 'foreign-child', parentSessionId: 'foreign-parent-2', relation: 'thread', user: admin });
        assert.throws(() => getSessionLinks('foreign-parent-2', member), { code: 'SESSION_ACCESS_DENIED', statusCode: 403 });
        assert.throws(() => getSessionLinks('no-such-session', admin), { code: 'SESSION_NOT_FOUND', statusCode: 404 });
    });
});
test('POST /api/providers/sessions with a parent creates a linked chat; refusals create nothing', async () => {
    await withWorld(async ({ admin, member, projectA, projectB, foreignProject }) => {
        sessionsDb.createAppSession('http-parent', 'claude', projectA);
        sessionsDb.createAppSession('http-foreign-parent', 'claude', foreignProject);
        const { default: providerRouter } = await import('../../../modules/providers/provider.routes.js');
        const { sessionLinksRoutes } = await import('../../../modules/session-links/index.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            const asAdmin = req.headers['x-as'] === 'admin';
            Object.assign(req, { user: asAdmin ? { id: admin.id, role: 'admin' } : { id: member.id, role: 'user' } });
            next();
        });
        app.use('/api/providers', providerRouter);
        app.use('/api/sessions', sessionLinksRoutes);
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode ?? 500).json({ error: { code: err.code } });
        });
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}/api`;
        const create = (body, as = 'member') => fetch(`${base}/providers/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-as': as },
            body: JSON.stringify(body),
        });
        try {
            const created = await create({ provider: 'grok', projectPath: projectA, parentSessionId: 'http-parent', relation: 'thread' });
            assert.equal(created.status, 201);
            const childId = (await created.json()).data.sessionId;
            assert.ok(childId);
            const childLinks = await fetch(`${base}/sessions/${childId}/links`);
            assert.equal(childLinks.status, 200);
            const { parent } = (await childLinks.json());
            assert.deepEqual([parent?.sessionId, parent?.relation], ['http-parent', 'thread']);
            const parentLinks = (await (await fetch(`${base}/sessions/http-parent/links`)).json());
            assert.deepEqual(parentLinks.children.map((child) => [child.sessionId, child.relation, child.provider]), [[childId, 'thread', 'grok']]);
            const countRows = (table) => getConnection().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
            const before = { sessions: countRows('sessions'), projects: countRows('projects') };
            const refusals = [
                [{ provider: 'grok', projectPath: projectA, parentSessionId: 'http-foreign-parent', relation: 'thread' }, 403],
                [{ provider: 'grok', projectPath: projectA, parentSessionId: 'missing-parent', relation: 'relay' }, 404],
                [{ provider: 'grok', projectPath: projectB, parentSessionId: 'http-parent', relation: 'relay' }, 400],
                [{ provider: 'grok', projectPath: projectA, parentSessionId: 'http-parent', relation: 'sibling' }, 400],
            ];
            for (const [body, status] of refusals) {
                assert.equal((await create(body)).status, status, JSON.stringify(body));
            }
            // An admin may open chats in a not-yet-known folder; with a bad parent
            // that folder must not become a project.
            assert.equal((await create({ provider: 'grok', projectPath: '/workspace/links-brand-new', parentSessionId: 'http-parent', relation: 'relay' }, 'admin')).status, 400);
            assert.deepEqual({ sessions: countRows('sessions'), projects: countRows('projects') }, before, 'a refused link must leave neither a chat nor a project behind');
            assert.equal((await fetch(`${base}/sessions/http-foreign-parent/links`)).status, 403);
        }
        finally {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
test('renaming or archiving a linked chat re-sends the cards that show it', async () => {
    await withWorld(async ({ admin, projectA }) => {
        sessionsDb.createAppSession('card-parent', 'claude', projectA);
        sessionsDb.createAppSession('card-child', 'grok', projectA);
        linkSession({ childSessionId: 'card-child', parentSessionId: 'card-parent', relation: 'relay', user: admin });
        const { default: providerRouter } = await import('../../../modules/providers/provider.routes.js');
        const { clientIdentities } = await import('../../../modules/websocket/services/project-access.service.js');
        const { connectedClients } = await import('../../../modules/websocket/services/websocket-state.service.js');
        const frames = [];
        const socket = { readyState: 1, send: (payload) => { frames.push(JSON.parse(payload)); } };
        clientIdentities.set(socket, { id: admin.id, role: 'admin' });
        connectedClients.add(socket);
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { Object.assign(req, { user: { id: admin.id, role: 'admin' } }); next(); });
        app.use('/api/providers', providerRouter);
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}/api/providers`;
        const waitFor = async (probe) => {
            for (let attempt = 0; attempt < 50; attempt += 1) {
                const found = probe();
                if (found !== undefined)
                    return found;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error('expected frame never arrived');
        };
        try {
            const renamed = await fetch(`${base}/sessions/card-child`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ summary: 'Часть 2' }),
            });
            assert.equal(renamed.status, 200);
            const parentCard = await waitFor(() => frames.find((frame) => frame.kind === 'session_upserted' && frame.sessionId === 'card-parent'));
            assert.deepEqual(parentCard.session?.links?.children.map((child) => child.name), ['Часть 2']);
            frames.length = 0;
            await fetch(`${base}/sessions/card-parent`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ summary: 'Начало' }),
            });
            const childCard = await waitFor(() => frames.find((frame) => frame.kind === 'session_upserted' && frame.sessionId === 'card-child'));
            assert.equal(childCard.session?.links?.parent?.name, 'Начало');
            frames.length = 0;
            assert.equal((await fetch(`${base}/sessions/card-child`, { method: 'DELETE' })).status, 200);
            const afterArchive = await waitFor(() => frames.find((frame) => frame.kind === 'session_upserted' && frame.sessionId === 'card-parent'));
            assert.deepEqual(afterArchive.session?.links?.children, [], 'an archived continuation leaves the parent card');
        }
        finally {
            connectedClients.delete(socket);
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
//# sourceMappingURL=session-links.test.js.map