import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb, userProjectAccessDb, } from '../../modules/database/index.js';
import { sessionTokenUsageRoute } from '../session-token-usage.js';
// GET /api/projects/:projectId/sessions/:sessionId/token-usage used to answer
// for any session id. This mounts the exact chain server/index.js mounts
// (sessionTokenUsageRoute = guard + real handler), with only the JWT stubbed.
test('token usage of a session you cannot open is 403; your own and the admin pass', async () => {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-access-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const admin = userDb.createUserWithRole('dima', 'x', 'admin');
    const member = userDb.createUserWithRole('slava', 'x', 'user');
    // Cursor sessions: the real handler answers them without touching provider files.
    sessionsDb.createSession('sess-dima', 'cursor', '/workspace/dima', 'Димин');
    sessionsDb.createSession('sess-slava', 'cursor', '/workspace/slava', 'Славин');
    const slavaProject = projectsDb.getProjectPath('/workspace/slava').project_id;
    const dimaProject = projectsDb.getProjectPath('/workspace/dima').project_id;
    userProjectAccessDb.grantAccess(Number(member.id), slavaProject, Number(admin.id));
    const app = express();
    app.get('/api/projects/:projectId/sessions/:sessionId/token-usage', (req, _res, next) => {
        req.user = { id: Number(req.headers['x-user-id']), role: req.headers['x-role'] };
        next();
    }, ...sessionTokenUsageRoute);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (userId, role, projectId, sessionId) => fetch(`${base}/api/projects/${projectId}/sessions/${sessionId}/token-usage`, {
        headers: { 'x-user-id': String(userId), 'x-role': role },
    });
    try {
        // Someone else's session, even when the URL names a project you can see
        // and the token claims admin: refused before any usage is read.
        const stranger = await get(Number(member.id), 'admin', slavaProject, 'sess-dima');
        assert.equal(stranger.status, 403);
        assert.equal((await stranger.json()).used, undefined);
        assert.equal((await get(Number(member.id), 'user', dimaProject, 'sess-dima')).status, 403);
        const own = await get(Number(member.id), 'user', slavaProject, 'sess-slava');
        assert.equal(own.status, 200);
        assert.equal((await own.json()).unsupported, true);
        assert.equal((await get(Number(admin.id), 'admin', dimaProject, 'sess-dima')).status, 200);
        assert.equal((await get(Number(admin.id), 'admin', dimaProject, 'no-such-session')).status, 404);
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
});
//# sourceMappingURL=session-token-usage.test.js.map