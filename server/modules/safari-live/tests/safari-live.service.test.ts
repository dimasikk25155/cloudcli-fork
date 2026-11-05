import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserError } from '../safari-live.browser.js';
import { createSafariLiveService } from '../safari-live.service.js';
import type { BrowserDriver, BrowserEvent, BrowserReply, SafariViewer, StreamEnd } from '../safari-live.types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, what: string, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}

/** A fake driver: pages live in a map, like the helper's. */
function fakeDriver() {
  const pages = new Map<string, { url: string; title: string }>();
  const calls: Array<{ op: string; args: Record<string, unknown>; passive: boolean }> = [];
  const watchers = new Map<string, Set<(jpeg: Buffer) => void>>();
  const listeners = new Set<(event: BrowserEvent) => void>();
  let running = false;
  let stops = 0;
  let failNext: BrowserError | null = null;
  const emit = (event: BrowserEvent) => { for (const listener of [...listeners]) listener(event); };

  const driver: BrowserDriver = {
    async request(op, args = {}, options = {}) {
      running = true;
      calls.push({ op, args, passive: Boolean(options.passive) });
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      const page = String(args.page ?? '');
      const reply: BrowserReply = {};
      switch (op) {
        case 'list':
          return { pages: [...pages].map(([id, value]) => ({ page: id, ...value, loading: false })) };
        case 'open':
          pages.set(page, { url: String(args.url), title: `Title of ${args.url}` });
          return { url: String(args.url), title: `Title of ${args.url}` };
        case 'close':
          if (pages.delete(page)) emit({ event: 'closed', page });
          return { pages: pages.size };
        default:
          if (!pages.has(page)) throw new BrowserError('no_page', 'no such page');
          return { ...reply, op, url: pages.get(page)!.url, title: pages.get(page)!.title };
      }
    },
    watch(page, onFrame) {
      running = true;
      let set = watchers.get(page);
      if (!set) { set = new Set(); watchers.set(page, set); }
      set.add(onFrame);
      return () => {
        set!.delete(onFrame);
        if (set!.size === 0) watchers.delete(page);
      };
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isRunning: () => running,
    stop() {
      stops += 1;
      running = false;
      pages.clear();
      watchers.clear();
      emit({ event: 'exit', reason: 'stopped', code: null });
    },
  };
  return {
    driver,
    pages,
    calls,
    watchers,
    emit,
    frame: (page: string, text: string) => { for (const cb of [...(watchers.get(page) ?? [])]) cb(Buffer.from(text)); },
    die: () => { running = false; pages.clear(); watchers.clear(); emit({ event: 'exit', reason: 'died', code: 1 }); },
    stops: () => stops,
    setRunning: (on: boolean) => { running = on; },
    failNext: (error: BrowserError) => { failNext = error; },
  };
}

function viewer() {
  const frames: string[] = [];
  const ends: StreamEnd[] = [];
  const value: SafariViewer = { onFrame: (jpeg) => frames.push(jpeg.toString()), onEnd: (end) => ends.push(end) };
  return { frames, ends, value };
}

test('service: listing pages never starts the helper; open pages are listed 1280×800 with url and title (polls are passive)', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin', listCacheMs: 0 });
  assert.deepEqual(await service.listWindows(), { state: 'ok', windows: [] });
  assert.equal(fake.calls.length, 0, 'not running → nothing asked');
  assert.equal(service.isLoaded(), false);

  const opened = await service.openPage('chat-a', 'https://example.com/a');
  assert.deepEqual(opened, { pageId: 'chat-a', url: 'https://example.com/a', title: 'Title of https://example.com/a', width: 1280, height: 800, loading: false });
  assert.equal(service.isLoaded(), true);
  const list = await service.listWindows();
  assert.deepEqual(list, { state: 'ok', windows: [{ pageId: 'chat-a', url: 'https://example.com/a', title: 'Title of https://example.com/a', width: 1280, height: 800 }] });
  assert.equal(fake.calls.filter((call) => call.op === 'list').every((call) => call.passive), true);
});

test('service: not on a Mac → unsupported, nothing asked; helper not installed → error state', async () => {
  const fake = fakeDriver();
  const linux = createSafariLiveService({ driver: fake.driver, platform: 'linux' });
  assert.equal((await linux.listWindows()).state, 'unsupported');
  await assert.rejects(linux.openPage('chat-a', 'https://example.com/'), (error: unknown) => error instanceof BrowserError && error.code === 'unsupported');
  const v = viewer();
  linux.subscribe('chat-a', v.value);
  await waitFor(() => v.ends.length > 0, 'end');
  assert.deepEqual(v.ends, ['error']);
  assert.equal(fake.calls.length, 0);

  const missing = createSafariLiveService({ driver: fake.driver, platform: 'darwin', helperInstalled: () => false });
  const list = await missing.listWindows();
  assert.equal(list.state, 'error');
  assert.match(list.message ?? '', /не установлен/);
});

test('service: a bad address is refused before the helper is asked', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin' });
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'не адрес', '']) {
    await assert.rejects(service.openPage('chat-a', url), (error: unknown) => error instanceof BrowserError && error.code === 'bad_url');
  }
  assert.equal(fake.calls.length, 0);
});

test('service: one watch per page shared by viewers; a new viewer gets the last frame; the last viewer leaving stops watching', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin', listCacheMs: 0 });
  await service.openPage('chat-a', 'https://example.com/a');
  const first = viewer();
  const stopFirst = service.subscribe('chat-a', first.value);
  await waitFor(() => fake.watchers.has('chat-a'), 'watch');
  fake.frame('chat-a', 'F1');
  const second = viewer();
  const stopSecond = service.subscribe('chat-a', second.value);
  assert.deepEqual(second.frames, ['F1'], 'last frame at once');
  fake.frame('chat-a', 'F2');
  assert.deepEqual(first.frames, ['F1', 'F2']);
  assert.deepEqual(second.frames, ['F1', 'F2']);
  assert.equal(fake.watchers.get('chat-a')?.size, 1, 'one driver watch per page');
  assert.equal(service.activeStreams(), 1);
  stopFirst();
  assert.ok(fake.watchers.has('chat-a'));
  stopSecond();
  assert.equal(fake.watchers.has('chat-a'), false);
  assert.equal(service.activeStreams(), 0);
});

test('service: unloaded helper + restore address → the page is opened there first, then streamed', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin', listCacheMs: 0 });
  const v = viewer();
  service.subscribe('chat-a', v.value, { url: 'https://example.com/last' });
  await waitFor(() => fake.watchers.has('chat-a'), 'watch after restore');
  assert.deepEqual(fake.calls.map((call) => [call.op, call.args.url ?? null]), [['open', 'https://example.com/last']]);
  fake.frame('chat-a', 'BACK');
  assert.deepEqual(v.frames, ['BACK']);

  // Without a restore address a missing page ends the picture.
  const lost = viewer();
  service.subscribe('chat-missing', lost.value);
  await waitFor(() => lost.ends.length > 0, 'end');
  assert.deepEqual(lost.ends, ['page_gone']);
});

test('service: a closed page or a dead helper ends its pictures (page_gone); a stopped helper ends them as stopped', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin', listCacheMs: 0 });
  await service.openPage('chat-a', 'https://example.com/a');
  await service.openPage('chat-b', 'https://example.com/b');
  const a = viewer();
  const b = viewer();
  service.subscribe('chat-a', a.value);
  service.subscribe('chat-b', b.value);
  await waitFor(() => fake.watchers.size === 2, 'two watches');
  fake.emit({ event: 'closed', page: 'chat-a' });
  assert.deepEqual(a.ends, ['page_gone']);
  assert.deepEqual(b.ends, []);
  fake.die();
  assert.deepEqual(b.ends, ['page_gone']);

  await service.openPage('chat-c', 'https://example.com/c');
  const c = viewer();
  service.subscribe('chat-c', c.value);
  await waitFor(() => fake.watchers.size === 1, 'watch c');
  service.stopAll();
  assert.deepEqual(c.ends, ['stopped']);
  assert.equal(service.isLoaded(), false);
});

test('service: closing the last page without viewers unloads the helper at once; with another page or a viewer it stays', async () => {
  const fake = fakeDriver();
  const service = createSafariLiveService({ driver: fake.driver, platform: 'darwin', listCacheMs: 0 });
  await service.openPage('chat-a', 'https://example.com/a');
  await service.openPage('chat-b', 'https://example.com/b');
  assert.deepEqual(await service.closePage('chat-a'), { closed: true, unloaded: false });
  assert.equal(fake.stops(), 0);

  const v = viewer();
  const stop = service.subscribe('chat-b', v.value);
  await waitFor(() => fake.watchers.has('chat-b'), 'watch');
  await service.openPage('chat-c', 'https://example.com/c');
  assert.deepEqual(await service.closePage('chat-c'), { closed: true, unloaded: false }, 'a viewer keeps it');
  stop();
  assert.deepEqual(await service.closePage('chat-b'), { closed: true, unloaded: true });
  assert.equal(fake.stops(), 1);
  assert.equal(service.isLoaded(), false);
  // Nothing running: closing asks nothing.
  const before = fake.calls.length;
  assert.deepEqual(await service.closePage('chat-b'), { closed: false, unloaded: true });
  assert.equal(fake.calls.length, before);
});

test('service: commands and input go to the page; helper errors come back as BrowserError; navigation is reported', async () => {
  const fake = fakeDriver();
  const navigated: Array<[string, string, string]> = [];
  const service = createSafariLiveService({
    driver: fake.driver,
    platform: 'darwin',
    listCacheMs: 0,
    onNavigated: (pageId, url, title) => navigated.push([pageId, url, title]),
  });
  await service.openPage('chat-a', 'https://example.com/a');
  const reply = await service.command('click', 'chat-a', { selector: '#go' });
  assert.equal(reply.op, 'click');
  assert.deepEqual(fake.calls.at(-1)?.args, { page: 'chat-a', selector: '#go' });

  await service.input('chat-a', { kind: 'text', text: 'секрет' });
  assert.deepEqual(fake.calls.at(-1), { op: 'input', args: { page: 'chat-a', kind: 'text', text: 'секрет' }, passive: false });

  await assert.rejects(service.command('read', 'chat-zzz', { format: 'text' }), (error: unknown) => error instanceof BrowserError && error.code === 'no_page');

  fake.emit({ event: 'navigated', page: 'chat-a', url: 'https://example.com/next', title: 'Next' });
  assert.deepEqual(navigated, [['chat-a', 'https://example.com/next', 'Next']]);
});
