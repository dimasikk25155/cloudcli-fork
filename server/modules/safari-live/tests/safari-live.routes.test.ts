import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import type { BrowserInput, SafariLiveService, SafariWindowList } from '@/modules/safari-live/index.js';

process.env.JWT_SECRET = 'safari-live-routes-test-secret-0123456789';
const { closeConnection, initializeDatabase, projectsDb, safariLiveBindingsDb, sessionsDb, userDb } = await import('@/modules/database/index.js');
// eslint-disable-next-line boundaries/no-unknown -- the real auth middleware: 401/403 exactly as mounted in server/index.js
const { authenticateToken, authenticateWebSocket, generateToken, requireAdmin } = await import('@/middleware/auth.js');
const { apiErrorHandler } = await import('@/shared/utils.js');
const { BrowserError, createSafariLiveRouter, readStreamToken, signStreamToken } = await import('@/modules/safari-live/index.js');

type Reply = { status: number; body: any };

const page = (pageId: string, title: string, url: string) => ({ pageId, title, url, width: 1280, height: 800 });

function fakeService(
  list: () => SafariWindowList,
  calls: string[],
  inputs: Array<[string, BrowserInput]>,
  inputError: () => Error | null,
  helper: () => { loaded: boolean; closedByAgent: Set<string> },
): SafariLiveService {
  return {
    listWindows: async () => list(),
    isLoaded: () => helper().loaded,
    canRestore: (pageId) => !helper().loaded && !helper().closedByAgent.has(pageId),
    openPage: async () => { calls.push('open'); throw new Error('not used'); },
    closePage: async () => ({ closed: false, unloaded: true }),
    command: async (op) => { calls.push(op); return {}; },
    input: async (pageId, input) => {
      const error = inputError();
      if (error) throw error;
      inputs.push([pageId, input]);
    },
    subscribe: () => () => {},
    activeStreams: () => 0,
    stopAll: () => {},
  };
}

async function withServer(run: (ctx: {
  call: (method: 'GET' | 'PUT' | 'POST', route: string, options?: { as?: 'admin' | 'member' | 'nobody'; body?: unknown; bearer?: string }) => Promise<Reply & { refreshed: string | null }>;
  setList: (list: SafariWindowList) => void;
  setModOn: (on: boolean) => void;
  setLoaded: (on: boolean) => void;
  closedByAgent: Set<string>;
  setInputError: (error: Error | null) => void;
  inputs: Array<[string, BrowserInput]>;
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
    windows: [page('chat-chat', 'Яндекс', 'https://ya.ru/'), page('chat-other', 'GitHub', 'https://github.com/')],
  };
  let modOn = true;
  let loaded = true;
  const closedByAgent = new Set<string>();
  let inputError: Error | null = null;
  const inputs: Array<[string, BrowserInput]> = [];
  const calls: string[] = [];
  const notified: Array<[number, string]> = [];
  const tokens = {
    admin: generateToken({ id: adminId, username: 'dima' }),
    member: generateToken({ id: Number(member.id), username: 'slavik' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/safari-live', authenticateToken, requireAdmin, createSafariLiveRouter({
    service: fakeService(() => list, calls, inputs, () => inputError, () => ({ loaded, closedByAgent })),
    bindings: safariLiveBindingsDb,
    modOn: () => modOn,
    notify: (userId, sessionId) => { notified.push([userId, sessionId]); },
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/safari-live`;
  const silence = console.error;
  const silenceLog = console.log;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try {
    await run({
      call: async (method, route, options = {}) => {
        const as = options.as ?? 'admin';
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`;
        else if (as !== 'nobody') headers.authorization = `Bearer ${tokens[as]}`;
        const response = await fetch(`${base}${route}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : null, refreshed: response.headers.get('x-refreshed-token') };
      },
      setList: (next) => { list = next; },
      setModOn: (on) => { modOn = on; },
      setLoaded: (on) => { loaded = on; },
      closedByAgent,
      setInputError: (error) => { inputError = error; },
      inputs,
      calls,
      notified,
      adminId,
    });
    assert.equal(logged.some((line) => line.includes('пароль-секрет')), false, 'typed text never reaches a log');
  } finally {
    console.error = silence;
    console.log = silenceLog;
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
    assert.equal((await call('POST', '/sessions/chat/input', { as: 'nobody', body: { kind: 'click', x: 1, y: 1 } })).status, 401);
    assert.equal((await call('GET', '/windows', { as: 'member' })).status, 403);
    assert.equal((await call('PUT', '/sessions/chat', { as: 'member', body: { pageId: 'chat-chat' } })).status, 403);
    assert.equal((await call('POST', '/sessions/chat/input', { as: 'member', body: { kind: 'click', x: 1, y: 1 } })).status, 403);

    assert.equal((await call('GET', '/sessions/no-such-chat')).status, 404);
    assert.equal((await call('PUT', '/sessions/no-such-chat', { body: { pageId: 'chat-chat' } })).status, 404);
    assert.equal((await call('POST', '/sessions/no-such-chat/input', { body: { kind: 'click', x: 1, y: 1 } })).status, 404);

    setModOn(false);
    for (const reply of [
      await call('GET', '/windows'),
      await call('GET', '/sessions/chat'),
      await call('PUT', '/sessions/chat', { body: { pageId: 'chat-chat' } }),
      await call('POST', '/sessions/chat/input', { body: { kind: 'click', x: 1, y: 1 } }),
    ]) {
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error.code, 'MOD_OFF');
    }
  });
});

test('GET /windows lists browser pages; GET /sessions/:id is empty until a page is bound', async () => {
  await withServer(async ({ call }) => {
    const windows = await call('GET', '/windows');
    assert.equal(windows.status, 200);
    assert.equal(windows.body.data.state, 'ok');
    assert.deepEqual(windows.body.data.windows, [
      { pageId: 'chat-chat', title: 'Яндекс', url: 'https://ya.ru/', width: 1280, height: 800 },
      { pageId: 'chat-other', title: 'GitHub', url: 'https://github.com/', width: 1280, height: 800 },
    ]);

    const view = await call('GET', '/sessions/chat');
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.data, { state: 'ok', binding: null, windowAlive: false, streamUrl: null, windows: windows.body.data.windows });
  });
});

test('PUT /sessions/:id binds the page (by the user) with its address, pings the user, returns a stream link; «unloaded» + link only while the helper is unloaded', async () => {
  await withServer(async ({ call, setList, setLoaded, closedByAgent, calls, notified, adminId }) => {
    const bound = await call('PUT', '/sessions/chat', { body: { pageId: 'chat-other' } });
    assert.equal(bound.status, 200);
    const view = bound.body.data;
    assert.equal(view.state, 'ok');
    assert.equal(view.binding.pageId, 'chat-other');
    assert.equal(view.binding.url, 'https://github.com/');
    assert.equal(view.binding.title, 'GitHub');
    assert.equal(view.binding.boundBy, 'user');
    assert.equal(view.windowAlive, true);
    assert.deepEqual(calls, [], 'binding opens nothing');
    assert.deepEqual(notified, [[adminId, 'chat']]);

    const match = /^\/sl\/([^/]+)\/stream$/.exec(view.streamUrl);
    assert.ok(match, `stream link shape: ${view.streamUrl}`);
    assert.deepEqual(readStreamToken(match[1]), { userId: adminId, pageId: 'chat-other', sessionId: 'chat' });

    // The page went elsewhere: the view shows its current address and title.
    setList({ state: 'ok', windows: [page('chat-other', 'GitHub — Pulls', 'https://github.com/pulls')] });
    const moved = await call('GET', '/sessions/chat');
    assert.equal(moved.body.data.binding.url, 'https://github.com/pulls');
    assert.equal(moved.body.data.binding.title, 'GitHub — Pulls');

    // The agent closed the page (browser.close) while the helper still runs: the tab
    // shows «page closed», no link — nothing reopens the page the agent is done with.
    setList({ state: 'ok', windows: [page('chat-chat', 'Яндекс', 'https://ya.ru/')] });
    const closed = await call('GET', '/sessions/chat');
    assert.equal(closed.body.data.state, 'ok');
    assert.equal(closed.body.data.windowAlive, false);
    assert.equal(closed.body.data.binding.pageId, 'chat-other');
    assert.equal(closed.body.data.streamUrl, null);

    // The closed page was the last one and the helper left memory at once: still closed, no link.
    setList({ state: 'ok', windows: [] });
    setLoaded(false);
    closedByAgent.add('chat-other');
    const closedUnloaded = await call('GET', '/sessions/chat');
    assert.equal(closedUnloaded.body.data.state, 'ok');
    assert.equal(closedUnloaded.body.data.streamUrl, null);

    // The helper was unloaded by itself (idle, restart): the binding stays, state «unloaded»,
    // the link reopens the last page.
    closedByAgent.clear();
    const unloaded = await call('GET', '/sessions/chat');
    assert.equal(unloaded.body.data.state, 'unloaded');
    assert.equal(unloaded.body.data.windowAlive, false);
    assert.equal(unloaded.body.data.binding.pageId, 'chat-other');
    assert.ok(unloaded.body.data.streamUrl, 'stream link to reopen the last page');
    assert.deepEqual(calls, [], 'the view itself opens nothing');

    // The browser is broken: state comes through, no link.
    setList({ state: 'error', windows: [], message: 'Браузер не установлен' });
    const broken = await call('GET', '/sessions/chat');
    assert.equal(broken.body.data.state, 'error');
    assert.equal(broken.body.data.streamUrl, null);
    assert.equal(broken.body.data.message, 'Браузер не установлен');
  });
});

test('PUT /sessions/:id with a page that is gone → 404 PAGE_GONE; a bad body → 400; nothing is bound', async () => {
  await withServer(async ({ call, calls, notified }) => {
    const gone = await call('PUT', '/sessions/chat', { body: { pageId: 'chat-nope' } });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error.code, 'PAGE_GONE');
    for (const body of [{ pageId: 345 }, { windowId: 345 }, { pageId: '' }]) {
      assert.equal((await call('PUT', '/sessions/chat', { body })).status, 400);
    }
    assert.equal((await call('GET', '/sessions/chat')).body.data.binding, null);
    assert.deepEqual(calls, []);
    assert.deepEqual(notified, []);
  });
});

test('POST /sessions/:id/input: the user\'s input goes to the chat\'s page (page pixels, clamped) → 204; no page → 404; bad input → 400; text is never logged', async () => {
  await withServer(async ({ call, inputs, setInputError }) => {
    const none = await call('POST', '/sessions/chat/input', { body: { kind: 'click', x: 10, y: 10 } });
    assert.equal(none.status, 404);
    assert.equal(none.body.error.code, 'NO_PAGE');

    await call('PUT', '/sessions/chat', { body: { pageId: 'chat-chat' } });
    for (const body of [
      { kind: 'click', x: 100.5, y: 200 },
      { kind: 'move', x: 5000, y: -3 },
      { kind: 'down', x: 1, y: 2 },
      { kind: 'up', x: 1, y: 2 },
      { kind: 'scroll', dy: 120, x: 640, y: 400 },
      { kind: 'key', key: 'Enter' },
      { kind: 'text', text: 'пароль-секрет' },
    ]) {
      const reply = (await call('POST', '/sessions/chat/input', { body })).status;
      assert.equal(reply, 204, JSON.stringify(body).replace('пароль-секрет', '***'));
    }
    assert.deepEqual(inputs, [
      ['chat-chat', { kind: 'click', x: 100.5, y: 200 }],
      ['chat-chat', { kind: 'move', x: 1280, y: 0 }],
      ['chat-chat', { kind: 'down', x: 1, y: 2 }],
      ['chat-chat', { kind: 'up', x: 1, y: 2 }],
      ['chat-chat', { kind: 'scroll', dy: 120, x: 640, y: 400 }],
      ['chat-chat', { kind: 'key', key: 'Enter' }],
      ['chat-chat', { kind: 'text', text: 'пароль-секрет' }],
    ]);

    for (const body of [{ kind: 'drag' }, { kind: 'click' }, { kind: 'key', key: 'F13' }, { kind: 'text', text: '' }, { kind: 'scroll' }, { kind: 'click', x: '1', y: 1 }]) {
      const reply = await call('POST', '/sessions/chat/input', { body });
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.equal(JSON.stringify(reply.body).includes('пароль-секрет'), false);
    }

    setInputError(new BrowserError('no_page', 'no such page'));
    const gone = await call('POST', '/sessions/chat/input', { body: { kind: 'text', text: 'пароль-секрет' } });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error.code, 'PAGE_GONE');
    assert.equal(JSON.stringify(gone.body).includes('пароль-секрет'), false, 'the reply does not echo the text');
    setInputError(new Error('boom пароль-секрет'));
    const failed = await call('POST', '/sessions/chat/input', { body: { kind: 'text', text: 'пароль-секрет' } });
    assert.equal(failed.status, 502);
    assert.equal(JSON.stringify(failed.body).includes('пароль-секрет'), false);
  });
});

test('a stream link token is never a login: as Bearer, as ?token= and as a WebSocket token it is refused', async () => {
  await withServer(async ({ call, adminId }) => {
    const streamToken = signStreamToken({ userId: adminId, pageId: 'chat-other' });
    // Sanity: the admin's own login works on the same routes.
    assert.equal((await call('GET', '/windows')).status, 200);

    for (const route of ['/windows', '/sessions/chat']) {
      const asBearer = await call('GET', route, { bearer: streamToken });
      assert.ok([401, 403].includes(asBearer.status), `Bearer on ${route}: ${asBearer.status}`);
      assert.equal(asBearer.refreshed, null, 'no full login token is handed out');

      const asQuery = await call('GET', `${route}?token=${encodeURIComponent(streamToken)}`, { as: 'nobody' });
      assert.ok([401, 403].includes(asQuery.status), `?token= on ${route}: ${asQuery.status}`);
      assert.equal(asQuery.refreshed, null);
    }
    assert.equal((await call('PUT', '/sessions/chat', { bearer: streamToken, body: { pageId: 'chat-other' } })).status >= 401, true);
    assert.equal((await call('POST', '/sessions/chat/input', { bearer: streamToken, body: { kind: 'click', x: 1, y: 1 } })).status >= 401, true);

    assert.equal(authenticateWebSocket(streamToken), null);
    // A login token is still not a stream link either.
    assert.equal(readStreamToken(generateToken({ id: adminId, username: 'dima' })), null);
  });
});
