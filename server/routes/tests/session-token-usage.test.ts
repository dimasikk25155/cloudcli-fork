import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
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
  const slavaProject = projectsDb.getProjectPath('/workspace/slava')!.project_id;
  const dimaProject = projectsDb.getProjectPath('/workspace/dima')!.project_id;
  userProjectAccessDb.grantAccess(Number(member.id), slavaProject, Number(admin.id));

  const app = express();
  app.get(
    '/api/projects/:projectId/sessions/:sessionId/token-usage',
    (req, _res, next) => {
      (req as express.Request & { user?: unknown }).user = { id: Number(req.headers['x-user-id']), role: req.headers['x-role'] };
      next();
    },
    ...sessionTokenUsageRoute,
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (userId: number, role: string, projectId: string, sessionId: string) =>
    fetch(`${base}/api/projects/${projectId}/sessions/${sessionId}/token-usage`, {
      headers: { 'x-user-id': String(userId), 'x-role': role },
    });

  try {
    // Someone else's session, even when the URL names a project you can see
    // and the token claims admin: refused before any usage is read.
    const stranger = await get(Number(member.id), 'admin', slavaProject, 'sess-dima');
    assert.equal(stranger.status, 403);
    assert.equal(((await stranger.json()) as { used?: unknown }).used, undefined);
    assert.equal((await get(Number(member.id), 'user', dimaProject, 'sess-dima')).status, 403);

    const own = await get(Number(member.id), 'user', slavaProject, 'sess-slava');
    assert.equal(own.status, 200);
    assert.equal(((await own.json()) as { unsupported?: boolean }).unsupported, true);

    assert.equal((await get(Number(admin.id), 'admin', dimaProject, 'sess-dima')).status, 200);
    assert.equal((await get(Number(admin.id), 'admin', dimaProject, 'no-such-session')).status, 404);

    // A teammate's indexed Codex transcript lives outside Dima's ~/.codex.
    // App-facing ids also need not equal the native thread id.
    const transcript = path.join(tempDirectory, 'rollout-native-codex.jsonl');
    await writeFile(transcript, `${JSON.stringify({ type: 'event_msg', payload: {
      type: 'token_count', info: { model_context_window: 475000,
        last_token_usage: { total_tokens: 103715 },
        total_token_usage: { input_tokens: 525086, output_tokens: 2556 },
      },
    } })}\n`);
    sessionsDb.createAppSession('app-codex', 'codex', '/workspace/slava');
    sessionsDb.createSession('native-codex', 'codex', '/workspace/slava', undefined, undefined, undefined, transcript);
    sessionsDb.assignProviderSessionId('app-codex', 'native-codex');
    const codex = await get(Number(member.id), 'user', slavaProject, 'app-codex');
    assert.equal(codex.status, 200);
    assert.deepEqual(await codex.json(), { used: 103715, total: 475000, inputTokens: 525086, outputTokens: 2556 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
