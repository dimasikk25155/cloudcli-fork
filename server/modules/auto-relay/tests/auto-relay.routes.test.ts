import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type Request } from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { createAutoRelayRoutes, createAutoRelayService } from '@/modules/auto-relay/index.js';

// GET/PUT /api/sessions/:id/auto-relay: the per-chat switch, behind the
// chat's project access; off until someone turns it on.

type Reply = { status: number; body: Record<string, unknown> };

async function withServer(runTest: (call: (method: 'GET' | 'PUT', sessionId: string, body?: unknown, as?: 'member' | 'stranger') => Promise<Reply>) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'auto-relay-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
  const member = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
  const stranger = Number(userDb.createUserWithRole('stranger', 'unused', 'user').id);
  const project = projectsDb.createProjectPath(path.join(directory, 'project')).project!;
  userProjectAccessDb.grantAccess(member, project.project_id, admin);
  sessionsDb.createAppSession('chat', 'claude', project.project_path);

  const service = createAutoRelayService({ broadcast: () => {} });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: unknown }).user = { id: req.header('x-as') === 'stranger' ? stranger : member };
    next();
  });
  app.use('/api/sessions', createAutoRelayRoutes(service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  try {
    await runTest(async (method, sessionId, body, as = 'member') => {
      const response = await fetch(`${base}/${encodeURIComponent(sessionId)}/auto-relay`, {
        method,
        headers: { 'content-type': 'application/json', 'x-as': as },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
  } finally {
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('the switch is off by default and turns on and off for a member of the project', async () => {
  await withServer(async (call) => {
    const initial = await call('GET', 'chat');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { sessionId: 'chat', enabled: false, state: null, childSessionId: null, childTitle: null, error: null });

    const on = await call('PUT', 'chat', { enabled: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.enabled, true);
    assert.equal((await call('GET', 'chat')).body.enabled, true);

    const off = await call('PUT', 'chat', { enabled: false });
    assert.equal(off.body.enabled, false);
  });
});

test('a stranger, an unknown chat and a malformed body are refused', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', 'chat', undefined, 'stranger')).status, 403);
    assert.equal((await call('PUT', 'chat', { enabled: true }, 'stranger')).status, 403);
    assert.equal((await call('GET', 'missing')).status, 404);
    assert.equal((await call('PUT', 'chat', { enabled: 'yes' })).status, 400);
    assert.equal((await call('GET', 'chat')).body.enabled, false);
  });
});
