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
  queuedMessagesDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import {
  createQueuedMessagesRoutes,
  createQueuedMessagesService,
  type QueuedSendInput,
} from '@/modules/queued-messages/index.js';
import { apiErrorHandler } from '@/shared/utils.js';

// /api/sessions/:sessionId/queued-message — the queue of one chat over REST,
// behind the chat's project access (requireSessionAccess), mounted the way
// server/index.js mounts it.

type Method = 'GET' | 'PUT' | 'DELETE' | 'POST';
type Reply = { status: number; body: any };
type Who = 'member' | 'stranger';

type World = {
  call(method: Method, sessionId: string, options?: { body?: unknown; as?: Who; sendNow?: boolean }): Promise<Reply>;
  member: number;
  sent: QueuedSendInput[];
  aborts: string[];
  frames: string[];
  /** A turn of the chat is going. */
  live: boolean;
};

async function withServer(runTest: (world: World) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'queued-messages-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
  const member = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
  const stranger = Number(userDb.createUserWithRole('stranger', 'unused', 'user').id);
  const project = projectsDb.createProjectPath(path.join(directory, 'project')).project!;
  userProjectAccessDb.grantAccess(member, project.project_id, admin);
  sessionsDb.createAppSession('chat', 'claude', project.project_path);

  const world: World = {
    call: null as unknown as World['call'],
    member,
    sent: [],
    aborts: [],
    frames: [],
    live: true,
  };
  const service = createQueuedMessagesService({
    db: queuedMessagesDb,
    sendAsUser: (input) => { world.sent.push(input); world.live = true; return { started: true }; },
    getAttention: () => ({ state: world.live ? 'working' : 'done' }),
    isRunLive: () => world.live,
    abortRun: (sessionId) => { world.aborts.push(sessionId); world.live = false; return true; },
    notifyChanged: (sessionId) => { world.frames.push(sessionId); },
    log: () => {},
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: unknown }).user = { id: req.header('x-as') === 'stranger' ? stranger : member };
    next();
  });
  app.use('/api/sessions', createQueuedMessagesRoutes(service));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  world.call = async (method, sessionId, options = {}) => {
    const response = await fetch(`${base}/${encodeURIComponent(sessionId)}/queued-message${options.sendNow ? '/send-now' : ''}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-as': options.as ?? 'member' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await runTest(world);
  } finally {
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const BODY = {
  content: 'Потом проверь выкатку',
  options: { model: 'sonnet[1m]', permissionMode: 'default' },
  images: [{ path: 'shot.png' }],
};

test('PUT during a live turn stores the message, GET returns it, DELETE removes it', async () => {
  await withServer(async (world) => {
    assert.deepEqual(await world.call('GET', 'chat'), { status: 200, body: { queued: null } });

    const put = await world.call('PUT', 'chat', { body: BODY });
    assert.equal(put.status, 200);
    assert.equal(put.body.sent, false);
    assert.equal(put.body.queued.sessionId, 'chat');
    assert.equal(put.body.queued.content, BODY.content);
    assert.deepEqual(put.body.queued.options, BODY.options);
    assert.deepEqual(put.body.queued.images, BODY.images);
    assert.equal(put.body.queued.holdReason, null);
    assert.equal(put.body.queued.lastError, null);
    assert.ok(!Number.isNaN(Date.parse(put.body.queued.createdAt)));
    assert.equal(world.sent.length, 0);
    // Queued for the user of the request, not for anyone named in the body.
    assert.equal(queuedMessagesDb.get('chat')?.userId, world.member);

    const got = await world.call('GET', 'chat');
    assert.deepEqual(got.body, { queued: put.body.queued });

    assert.deepEqual(await world.call('DELETE', 'chat'), { status: 200, body: { ok: true } });
    assert.deepEqual((await world.call('GET', 'chat')).body, { queued: null });
    // Removing nothing is still fine: the card is gone either way.
    assert.deepEqual(await world.call('DELETE', 'chat'), { status: 200, body: { ok: true } });
    assert.deepEqual(world.frames, ['chat', 'chat']);
  });
});

test('someone else\'s chat is refused by the shared access rule on every route; an unknown chat is 404', async () => {
  await withServer(async (world) => {
    await world.call('PUT', 'chat', { body: BODY });

    for (const [method, options] of [
      ['GET', {}],
      ['PUT', { body: { content: 'чужое' } }],
      ['DELETE', {}],
      ['POST', { sendNow: true }],
    ] as Array<[Method, { body?: unknown; sendNow?: boolean }]>) {
      const reply = await world.call(method, 'chat', { ...options, as: 'stranger' });
      assert.equal(reply.status, 403, `${method} as a stranger`);
      assert.equal(JSON.stringify(reply.body).includes(BODY.content), false);
      assert.equal((await world.call(method, 'no-such-chat', options)).status, 404, `${method} on an unknown chat`);
    }

    assert.equal(queuedMessagesDb.get('chat')?.content, BODY.content, 'the stranger changed nothing');
    assert.equal(world.sent.length, 0);
    assert.equal(world.aborts.length, 0);
  });
});

test('PUT with no live turn sends at once: sent true, nothing left queued', async () => {
  await withServer(async (world) => {
    world.live = false;
    const put = await world.call('PUT', 'chat', { body: BODY });
    assert.deepEqual(put, { status: 200, body: { queued: null, sent: true } });
    assert.deepEqual(world.sent, [{ sessionId: 'chat', userId: world.member, content: BODY.content, options: BODY.options, images: BODY.images }]);
    assert.deepEqual((await world.call('GET', 'chat')).body, { queued: null });
  });
});

test('an empty message is a 400, a broken body too', async () => {
  await withServer(async (world) => {
    const empty = await world.call('PUT', 'chat', { body: { content: '  ' } });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'QUEUED_MESSAGE_EMPTY');
    assert.equal((await world.call('PUT', 'chat', { body: { options: {} } })).status, 400);
    assert.equal((await world.call('PUT', 'chat', { body: { content: 'x', images: 'нет' } })).status, 400);
    assert.deepEqual((await world.call('GET', 'chat')).body, { queued: null });
  });
});

test('send-now stops the live turn on the server and sends; with nothing queued it is a 404', async () => {
  await withServer(async (world) => {
    await world.call('PUT', 'chat', { body: BODY });
    const reply = await world.call('POST', 'chat', { sendNow: true });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.ok, true);
    assert.deepEqual(world.aborts, ['chat']);
    assert.equal(world.sent.length, 1);
    assert.equal(world.sent[0].content, BODY.content);
    assert.deepEqual((await world.call('GET', 'chat')).body, { queued: null });

    const nothing = await world.call('POST', 'chat', { sendNow: true });
    assert.equal(nothing.status, 404);
    assert.equal(nothing.body.error.code, 'QUEUED_MESSAGE_NOT_FOUND');
  });
});
