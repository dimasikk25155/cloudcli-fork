import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

process.env.JWT_SECRET = 'agent-queue-routes-test-secret-0123456789abcdef';
const { agentsDb, closeConnection, initializeDatabase, projectsDb, userDb } = await import('@/modules/database/index.js');
// eslint-disable-next-line boundaries/no-unknown -- the real auth middleware: 401/403 exactly as mounted in server/index.js
const { authenticateToken, generateToken, requireAdmin } = await import('@/middleware/auth.js');
const { apiErrorHandler } = await import('@/shared/utils.js');
const { createAgentQueueRouter, createAgentQueueService } = await import('@/modules/agent-queue/index.js');

type Method = 'GET' | 'POST' | 'DELETE';
type Reply = { status: number; body: any };

async function withServer(run: (ctx: {
  call: (method: Method, route: string, options?: { as?: 'admin' | 'member' | 'nobody'; body?: unknown }) => Promise<Reply>;
  setModOn: (on: boolean) => void;
  service: ReturnType<typeof createAgentQueueService>;
}) => Promise<void>) {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-queue-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = userDb.createUserWithRole('dima', 'unused', 'admin');
  const member = userDb.createUserWithRole('slavik', 'unused', 'user');
  const projectDir = path.join(directory, 'tyres');
  await mkdir(projectDir, { recursive: true });
  const project = projectsDb.createProjectPath(projectDir).project!.project_path;
  agentsDb.create({
    id: 'agent-artist', userId: Number(admin.id), name: 'Художник', role: 'Карточки', checks: '',
    provider: 'grok', model: 'grok-4.7', effort: null, projectPath: project, files: [],
  });

  let modOn = true;
  const service = createAgentQueueService({
    run: async () => ({ text: 'ВЕРДИКТ: FAIL — криво', sessionId: null }),
    checkUsageGuard: async () => ({ blocked: false }),
    notify: () => {},
    isModOn: () => true,
    linkSession: () => {},
  });
  const tokens = {
    admin: generateToken({ id: Number(admin.id), username: 'dima' }),
    member: generateToken({ id: Number(member.id), username: 'slavik' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agent-queue', authenticateToken, requireAdmin, createAgentQueueRouter({ service, modOn: () => modOn }));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-queue`;
  const silence = console.error;
  console.error = () => {};
  try {
    await run({
      call: async (method, route, options = {}) => {
        const as = options.as ?? 'admin';
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (as !== 'nobody') headers.authorization = `Bearer ${tokens[as]}`;
        const response = await fetch(`${base}${route}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return { status: response.status, body: await response.json() };
      },
      setModOn: (on) => { modOn = on; },
      service,
    });
    await service.idle();
  } finally {
    console.error = silence;
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('/api/agent-queue: 401 without login, 403 for a teammate, 409 MOD_OFF when «Конвейер» is off', async () => {
  await withServer(async ({ call, setModOn }) => {
    assert.equal((await call('GET', '/', { as: 'nobody' })).status, 401);
    assert.equal((await call('GET', '/', { as: 'member' })).status, 403);
    assert.equal((await call('POST', '/', { as: 'member', body: { agentId: 'agent-artist', items: ['a'] } })).status, 403);
    assert.equal((await call('POST', '/items/1/mark-ok', { as: 'member' })).status, 403);

    setModOn(false);
    for (const reply of [
      await call('GET', '/'),
      await call('POST', '/', { body: { agentId: 'agent-artist', items: ['a'] } }),
      await call('GET', '/some-id'),
      await call('POST', '/some-id/pause'),
      await call('POST', '/items/1/mark-ok'),
      await call('DELETE', '/some-id'),
    ]) {
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error.code, 'MOD_OFF');
    }
  });
});

test('/api/agent-queue: create, list, get with items, pause/resume/stop, retry, mark OK, delete', async () => {
  await withServer(async ({ call, service }) => {
    const empty = await call('POST', '/', { body: { agentId: 'agent-artist', items: [] } });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'NO_ITEMS');

    const created = await call('POST', '/', {
      body: { agentId: 'agent-artist', title: 'Pirelli', template: 'Перерисуй {{item}}', items: 'p1\np2', parallel: 2, maxAttempts: 1 },
    });
    assert.equal(created.status, 200);
    const queue = created.body.data.queue;
    assert.equal(queue.title, 'Pirelli');
    assert.equal(queue.agentName, 'Художник');
    assert.equal(queue.status, 'running');
    assert.deepEqual(queue.counts, { pending: 2, running: 0, ok: 0, rejected: 0, total: 2 });
    assert.deepEqual(Object.keys(queue.items[0]).sort(), [
      'attempts', 'excerpt', 'id', 'input', 'manual', 'pass', 'position', 'reason', 'sessionId', 'status', 'updatedAt', 'verdict',
    ]);

    assert.deepEqual((await call('GET', '/')).body.data.queues.map((item: { id: string }) => item.id), [queue.id]);
    assert.equal((await call('GET', '/unknown')).status, 404);

    assert.equal((await call('POST', `/${queue.id}/pause`)).body.data.queue.status, 'paused');
    assert.equal((await call('POST', `/${queue.id}/pause`)).status, 409);
    assert.equal((await call('POST', `/${queue.id}/resume`)).body.data.queue.status, 'running');

    await service.tick();
    await service.idle();
    const done = (await call('GET', `/${queue.id}`)).body.data.queue;
    assert.equal(done.status, 'done');
    assert.deepEqual(done.items.map((item: { status: string; reason: string }) => [item.status, item.reason]), [['rejected', 'криво'], ['rejected', 'криво']]);

    const marked = await call('POST', `/items/${done.items[0].id}/mark-ok`);
    assert.equal(marked.body.data.queue.items[0].manual, true);
    assert.equal(marked.body.data.queue.counts.ok, 1);

    const retried = await call('POST', `/${queue.id}/retry-rejected`);
    assert.equal(retried.body.data.queue.status, 'running');
    assert.equal(retried.body.data.queue.items[1].pass, 2);

    assert.equal((await call('POST', `/${queue.id}/stop`)).body.data.queue.status, 'stopped');
    assert.equal((await call('POST', `/${queue.id}/resume`)).status, 409);

    assert.equal((await call('DELETE', `/${queue.id}`)).body.data.removed, true);
    assert.equal((await call('GET', `/${queue.id}`)).status, 404);
  });
});
