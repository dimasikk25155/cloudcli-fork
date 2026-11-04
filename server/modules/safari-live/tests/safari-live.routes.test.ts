import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import type { SafariLiveService, SafariWindowList } from '@/modules/safari-live/index.js';

process.env.JWT_SECRET = 'safari-live-routes-test-secret-0123456789';
const { closeConnection, initializeDatabase, projectsDb, safariLiveBindingsDb, sessionsDb, userDb } = await import('@/modules/database/index.js');
// eslint-disable-next-line boundaries/no-unknown -- the real auth middleware: 401/403 exactly as mounted in server/index.js
const { authenticateToken, generateToken, requireAdmin } = await import('@/middleware/auth.js');
const { apiErrorHandler } = await import('@/shared/utils.js');
const { createSafariLiveRouter, readStreamToken } = await import('@/modules/safari-live/index.js');

type Reply = { status: number; body: any };

function fakeService(list: () => SafariWindowList, calls: string[]): SafariLiveService {
  return {
    listWindows: async () => list(),
    pickWindow: async () => ({ window: null, list: list() }),
    subscribe: () => () => {},
    ensureDisplay: async () => {
      calls.push('display');
      return { ok: true, bounds: { x: 2560, y: 1440, width: 1920, height: 1200 } };
    },
    placeOnDisplay: async (windowId) => {
      calls.push(`place:${windowId}`);
      return { ok: true };
    },
    activeStreams: () => 0,
    stopAll: () => {},
  };
}

async function withServer(run: (ctx: {
  call: (method: 'GET' | 'PUT', route: string, options?: { as?: 'admin' | 'member' | 'nobody'; body?: unknown }) => Promise<Reply>;
  setList: (list: SafariWindowList) => void;
  setModOn: (on: boolean) => void;
  calls: string[];
  notified: Array<[number, string]>;
  adminId: number;
}) => Promise<void>) {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'safari-live-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = userDb.createUserWithRole('dima', 'unused', 'admin');
  const member = userDb.createUserWithRole('slavik', 'unused', 'user');
  const adminId = Number(admin.id);
  const project = projectsDb.createProjectPath(path.join(directory, 'project')).project!;
  sessionsDb.createAppSession('chat', 'claude', project.project_path);

  let list: SafariWindowList = {
    state: 'ok',
    windows: [
      { windowId: 120, title: 'Яндекс', onScreen: true, width: 1280, height: 800 },
      { windowId: 345, title: 'GitHub', onScreen: false, width: 1440, height: 900 },
    ],
  };
  let modOn = true;
  const calls: string[] = [];
  const notified: Array<[number, string]> = [];
  const tokens = {
    admin: generateToken({ id: adminId, username: 'dima' }),
    member: generateToken({ id: Number(member.id), username: 'slavik' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/safari-live', authenticateToken, requireAdmin, createSafariLiveRouter({
    service: fakeService(() => list, calls),
    bindings: safariLiveBindingsDb,
    modOn: () => modOn,
    notify: (userId, sessionId) => { notified.push([userId, sessionId]); },
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/safari-live`;
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
      setList: (next) => { list = next; },
      setModOn: (on) => { modOn = on; },
      calls,
      notified,
      adminId,
    });
  } finally {
    console.error = silence;
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('/api/safari-live: 401 without login, 403 for a non-admin, 404 for an unknown chat, 409 MOD_OFF when the mod is off', async () => {
  await withServer(async ({ call, setModOn }) => {
    assert.equal((await call('GET', '/windows', { as: 'nobody' })).status, 401);
    assert.equal((await call('GET', '/sessions/chat', { as: 'nobody' })).status, 401);
    assert.equal((await call('GET', '/windows', { as: 'member' })).status, 403);
    assert.equal((await call('PUT', '/sessions/chat', { as: 'member', body: { windowId: 120 } })).status, 403);

    assert.equal((await call('GET', '/sessions/no-such-chat')).status, 404);
    assert.equal((await call('PUT', '/sessions/no-such-chat', { body: { windowId: 120 } })).status, 404);

    setModOn(false);
    for (const reply of [await call('GET', '/windows'), await call('GET', '/sessions/chat'), await call('PUT', '/sessions/chat', { body: { windowId: 120 } })]) {
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error.code, 'MOD_OFF');
    }
  });
});

test('GET /windows lists Safari windows; GET /sessions/:id is empty until a window is bound', async () => {
  await withServer(async ({ call }) => {
    const windows = await call('GET', '/windows');
    assert.equal(windows.status, 200);
    assert.equal(windows.body.data.state, 'ok');
    assert.deepEqual(windows.body.data.windows.map((window: { windowId: number }) => window.windowId), [120, 345]);

    const view = await call('GET', '/sessions/chat');
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.data, {
      state: 'ok',
      binding: null,
      windowAlive: false,
      streamUrl: null,
      windows: windows.body.data.windows,
    });
  });
});

test('PUT /sessions/:id binds the window (by the user), moves it onto the display, pings the user and returns a stream link', async () => {
  await withServer(async ({ call, setList, calls, notified, adminId }) => {
    const bound = await call('PUT', '/sessions/chat', { body: { windowId: 345 } });
    assert.equal(bound.status, 200);
    const view = bound.body.data;
    assert.equal(view.state, 'ok');
    assert.equal(view.binding.windowId, 345);
    assert.equal(view.binding.title, 'GitHub');
    assert.equal(view.binding.boundBy, 'user');
    assert.equal(view.windowAlive, true);
    assert.deepEqual(calls, ['display', 'place:345']);
    assert.deepEqual(notified, [[adminId, 'chat']]);

    const match = /^\/sl\/([^/]+)\/stream$/.exec(view.streamUrl);
    assert.ok(match, `stream link shape: ${view.streamUrl}`);
    assert.deepEqual(readStreamToken(match[1]), { userId: adminId, windowId: 345 });

    // The binding survives: GET returns it with a fresh link.
    const again = await call('GET', '/sessions/chat');
    assert.equal(again.body.data.binding.windowId, 345);
    assert.ok(again.body.data.streamUrl);

    // The window was closed: the binding stays, but there is no stream.
    setList({ state: 'ok', windows: [{ windowId: 120, title: 'Яндекс', onScreen: true, width: 1280, height: 800 }] });
    const closed = await call('GET', '/sessions/chat');
    assert.equal(closed.body.data.binding.windowId, 345);
    assert.equal(closed.body.data.windowAlive, false);
    assert.equal(closed.body.data.streamUrl, null);

    // No screen-recording permission: state comes through, no link.
    setList({ state: 'no_permission', windows: [], message: 'Нет разрешения «Запись экрана»' });
    const denied = await call('GET', '/sessions/chat');
    assert.equal(denied.body.data.state, 'no_permission');
    assert.equal(denied.body.data.streamUrl, null);
  });
});

test('PUT /sessions/:id with a window that is gone → 404 WINDOW_GONE; a bad body → 400; nothing is bound', async () => {
  await withServer(async ({ call, calls, notified }) => {
    const gone = await call('PUT', '/sessions/chat', { body: { windowId: 999 } });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error.code, 'WINDOW_GONE');

    const bad = await call('PUT', '/sessions/chat', { body: { windowId: 'abc' } });
    assert.equal(bad.status, 400);

    assert.equal((await call('GET', '/sessions/chat')).body.data.binding, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(notified, []);
  });
});
