import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserError } from '../safari-live.browser.js';
import type { SafariBindingsStore } from '../safari-live.routes.js';
import type { BrowserReply, SafariBinding, SafariLiveService, SafariWindow } from '../safari-live.types.js';

process.env.JWT_SECRET = 'safari-live-actions-test-secret-0123456789';
const { createSafariLiveActions } = await import('../safari-live.actions.js');

type AppErrorLike = { statusCode?: number; code?: string; message: string };

function memoryBindings(): SafariBindingsStore & { rows: Map<string, SafariBinding> } {
  const rows = new Map<string, SafariBinding>();
  return {
    rows,
    get: (sessionId) => rows.get(sessionId) ?? null,
    set: (sessionId, input) => {
      const row = { sessionId, ...input, updatedAt: new Date().toISOString() };
      rows.set(sessionId, row);
      return row;
    },
    markClosed: (pageId) => {
      for (const [sessionId, row] of rows) if (row.pageId === pageId) rows.set(sessionId, { ...row, url: '' });
    },
    clear: (sessionId) => { rows.delete(sessionId); },
  };
}

function fakeService() {
  const pages = new Map<string, SafariWindow>();
  const calls: Array<[string, string, Record<string, unknown>]> = [];
  let fail: BrowserError | null = null;
  let closeResult = { closed: true, unloaded: true };
  const service: SafariLiveService = {
    listWindows: async () => ({ state: 'ok', windows: [...pages.values()] }),
    isLoaded: () => pages.size > 0,
    canRestore: () => false,
    async openPage(pageId, url) {
      calls.push(['open', pageId, { url }]);
      if (fail) throw fail;
      if (!/^https?:/.test(url)) throw new BrowserError('bad_url', 'bad');
      const page = { pageId, url, title: `Заголовок ${url}`, width: 1280, height: 800 };
      pages.set(pageId, page);
      return { ...page, loading: false };
    },
    async closePage(pageId) {
      calls.push(['close', pageId, {}]);
      pages.delete(pageId);
      return closeResult;
    },
    async command(op, pageId, args = {}) {
      calls.push([op, pageId, args]);
      if (fail) throw fail;
      if (!pages.has(pageId)) throw new BrowserError('no_page', 'no such page');
      const page = pages.get(pageId)!;
      const reply: BrowserReply = { url: page.url, title: page.title };
      if (op === 'click') Object.assign(reply, { x: 10, y: 20 });
      if (op === 'read') Object.assign(reply, { content: 'Текст страницы', truncated: args.max === 100 });
      if (op === 'eval') Object.assign(reply, { result: { answer: 42 } });
      if (op === 'snapshot') Object.assign(reply, { jpeg: Buffer.from('JPEG').toString('base64'), width: 1280, height: 800 });
      if (op === 'wait') Object.assign(reply, { found: true });
      return reply;
    },
    input: async () => {},
    subscribe: () => () => {},
    activeStreams: () => 0,
    stopAll: () => {},
  };
  return {
    service,
    pages,
    calls,
    failNext: (error: BrowserError | null) => { fail = error; },
    setCloseResult: (value: { closed: boolean; unloaded: boolean }) => { closeResult = value; },
  };
}

function setup(options: { admin?: boolean; modOn?: boolean } = {}) {
  const fake = fakeService();
  const bindings = memoryBindings();
  const notified: Array<[number, string]> = [];
  const shots: Array<[string, string]> = [];
  const actions = createSafariLiveActions({
    service: fake.service,
    bindings,
    modOn: () => options.modOn ?? true,
    isAdmin: () => options.admin ?? true,
    notify: (userId, sessionId) => notified.push([userId, sessionId]),
    saveShot: async (sessionId, jpeg) => {
      shots.push([sessionId, jpeg.toString()]);
      return `/tmp/browser-shots/${sessionId}/shot.jpg`;
    },
  });
  return { ...fake, bindings, notified, shots, run: actions.run };
}

test('browser.open opens the chat\'s own page, binds it (by the agent), pings the tab and tells the agent to close it when done', async () => {
  const ctx = setup();
  const opened = await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/a' }) as Record<string, unknown>;
  assert.equal(opened.pageId, 'chat-s1');
  assert.equal(opened.url, 'https://example.com/a');
  assert.equal(opened.title, 'Заголовок https://example.com/a');
  assert.match(String(opened.message), /вкладка «Браузер»/);
  assert.match(String(opened.message), /browser\.close/);
  assert.deepEqual(ctx.calls, [['open', 'chat-s1', { url: 'https://example.com/a' }]]);
  const binding = ctx.bindings.get('s1');
  assert.equal(binding?.pageId, 'chat-s1');
  assert.equal(binding?.url, 'https://example.com/a');
  assert.equal(binding?.boundBy, 'agent');
  assert.deepEqual(ctx.notified, [[1, 's1']]);

  // safari.show {url} is the same thing.
  await ctx.run(1, 's1', 'safari.show', { url: 'https://example.com/b' });
  assert.deepEqual(ctx.calls.at(-1), ['open', 'chat-s1', { url: 'https://example.com/b' }]);
  assert.equal(ctx.bindings.get('s1')?.url, 'https://example.com/b');
  assert.equal(ctx.notified.length, 2);
});

test('non-admin → «Браузер доступен только администратору» (403); mod off → MOD_OFF; nothing reaches the browser', async () => {
  const member = setup({ admin: false });
  await assert.rejects(member.run(2, 's1', 'browser.open', { url: 'https://example.com/' }), (error: AppErrorLike) => error.statusCode === 403 && error.message === 'Браузер доступен только администратору');
  const off = setup({ modOn: false });
  await assert.rejects(off.run(1, 's1', 'browser.read', {}), (error: AppErrorLike) => error.statusCode === 409 && error.code === 'MOD_OFF');
  assert.equal(member.calls.length + off.calls.length, 0);
});

test('browser.* commands go to the chat\'s page with only their own fields; typed text is not echoed; read says when it was cut', async () => {
  const ctx = setup();
  await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/' });
  const clicked = await ctx.run(1, 's1', 'browser.click', { selector: '#go', other: 'x' }) as Record<string, unknown>;
  assert.deepEqual(clicked, { url: 'https://example.com/', title: 'Заголовок https://example.com/', x: 10, y: 20 });
  await ctx.run(1, 's1', 'browser.click', { text: 'Войти' });
  await ctx.run(1, 's1', 'browser.click', { x: 5, y: 6, selector: 'ignored' });
  const typed = await ctx.run(1, 's1', 'browser.type', { text: 'секрет', selector: '#q', submit: true }) as Record<string, unknown>;
  assert.equal(JSON.stringify(typed).includes('секрет'), false);
  await ctx.run(1, 's1', 'browser.press', { key: 'Tab' });
  await ctx.run(1, 's1', 'browser.scroll', { dy: 400 });
  const read = await ctx.run(1, 's1', 'browser.read', { format: 'links', max: 100 }) as Record<string, unknown>;
  assert.equal(read.content, 'Текст страницы');
  assert.equal(read.truncated, true);
  assert.match(String(read.message), /Обрезано до 100/);
  const evaluated = await ctx.run(1, 's1', 'browser.eval', { js: 'document.title' }) as Record<string, unknown>;
  assert.deepEqual(evaluated, { result: { answer: 42 } });
  await ctx.run(1, 's1', 'browser.wait', { selector: '.done', ms: 99_999 });

  assert.deepEqual(ctx.calls.slice(1), [
    ['click', 'chat-s1', { selector: '#go' }],
    ['click', 'chat-s1', { text: 'Войти' }],
    ['click', 'chat-s1', { x: 5, y: 6 }],
    ['type', 'chat-s1', { text: 'секрет', selector: '#q' }],
    ['press', 'chat-s1', { key: 'Enter' }],
    ['press', 'chat-s1', { key: 'Tab' }],
    ['scroll', 'chat-s1', { dy: 400 }],
    ['read', 'chat-s1', { format: 'links', max: 100 }],
    ['eval', 'chat-s1', { js: 'document.title' }],
    ['wait', 'chat-s1', { selector: '.done', ms: 30_000 }],
  ]);
});

test('browser.screenshot saves a JPEG of the chat\'s page and answers with its path', async () => {
  const ctx = setup();
  await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/' });
  const shot = await ctx.run(1, 's1', 'browser.screenshot', {}) as Record<string, unknown>;
  assert.equal(shot.path, '/tmp/browser-shots/s1/shot.jpg');
  assert.equal(shot.width, 1280);
  assert.deepEqual(ctx.shots, [['s1', 'JPEG']]);
});

test('browser.close closes the chat\'s page and says when the browser left memory; the binding is marked closed (no address) for every chat showing it', async () => {
  const ctx = setup();
  await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/' });
  await ctx.run(1, 's2', 'safari.show', { pageId: 'chat-s1' });
  const closed = await ctx.run(1, 's1', 'browser.close', {}) as Record<string, unknown>;
  assert.equal(closed.unloaded, true);
  assert.match(String(closed.message), /выгружен/);
  assert.deepEqual(ctx.calls.at(-1), ['close', 'chat-s1', {}]);
  // Nothing reopens a page the agent is done with — not a viewer, not a restart.
  assert.equal(ctx.bindings.get('s1')?.url, '');
  assert.equal(ctx.bindings.get('s1')?.pageId, 'chat-s1');
  assert.equal(ctx.bindings.get('s2')?.url, '');
  // Opened again → a normal binding with its address.
  await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/again' });
  assert.equal(ctx.bindings.get('s1')?.url, 'https://example.com/again');
});

test('safari.show {pageId} binds an already open page; an unknown page is a clear refusal', async () => {
  const ctx = setup();
  await ctx.run(1, 'other', 'browser.open', { url: 'https://example.com/other' });
  const shown = await ctx.run(1, 's1', 'safari.show', { pageId: 'chat-other' }) as Record<string, unknown>;
  assert.equal(shown.pageId, 'chat-other');
  assert.equal(ctx.bindings.get('s1')?.pageId, 'chat-other');
  // Commands of the chat now go to the page it shows.
  await ctx.run(1, 's1', 'browser.read', {});
  assert.equal(ctx.calls.at(-1)?.[1], 'chat-other');
  await assert.rejects(ctx.run(1, 's1', 'safari.show', { pageId: 'chat-zzz' }), (error: AppErrorLike) => error.statusCode === 404 && /browser\.open/.test(error.message));
});

test('refusals the agent can act on: no page, bad url, missing element, timeout, script error, helper missing, not a Mac, bad args', async () => {
  const ctx = setup();
  await assert.rejects(ctx.run(1, 's1', 'browser.read', {}), (error: AppErrorLike) => error.statusCode === 404 && error.code === 'NO_PAGE' && /browser\.open/.test(error.message));
  await assert.rejects(ctx.run(1, 's1', 'browser.open', { url: 'javascript:alert(1)' }), (error: AppErrorLike) => error.statusCode === 400 && error.code === 'BAD_URL');
  await assert.rejects(ctx.run(1, 's1', 'browser.open', {}), (error: AppErrorLike) => error.code === 'BAD_URL');
  await ctx.run(1, 's1', 'browser.open', { url: 'https://example.com/' });
  const cases: Array<[BrowserError, number, string]> = [
    [new BrowserError('no_element', 'element not found'), 404, 'NO_ELEMENT'],
    [new BrowserError('timeout', 'still loading'), 504, 'TIMEOUT'],
    [new BrowserError('js_error', 'boom'), 400, 'JS_ERROR'],
    [new BrowserError('navigation_failed', 'DNS'), 502, 'NAVIGATION_FAILED'],
    [new BrowserError('helper_missing', 'Браузер не установлен'), 503, 'BROWSER_MISSING'],
    [new BrowserError('unsupported', 'only mac'), 409, 'UNSUPPORTED'],
  ];
  for (const [error, status, code] of cases) {
    ctx.failNext(error);
    await assert.rejects(ctx.run(1, 's1', 'browser.click', { selector: '#x' }), (refusal: AppErrorLike) => refusal.statusCode === status && refusal.code === code);
  }
  ctx.failNext(null);
  await assert.rejects(ctx.run(1, 's1', 'browser.click', {}), (error: AppErrorLike) => error.statusCode === 400);
  await assert.rejects(ctx.run(1, 's1', 'browser.press', { key: 'F13' }), (error: AppErrorLike) => error.statusCode === 400);
  await assert.rejects(ctx.run(1, 's1', 'browser.read', { format: 'pdf' }), (error: AppErrorLike) => error.statusCode === 400);
  await assert.rejects(ctx.run(1, 's1', 'browser.eval', {}), (error: AppErrorLike) => error.statusCode === 400);
  await assert.rejects(ctx.run(1, 's1', 'browser.type', {}), (error: AppErrorLike) => error.statusCode === 400);
});
