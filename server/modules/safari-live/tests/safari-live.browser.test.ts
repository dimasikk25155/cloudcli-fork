import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserError, createBrowserDriver } from '../safari-live.browser.js';
import type { BrowserEvent, BrowserProcess } from '../safari-live.types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake `neo3-browser serve`: records command lines, replies like the helper (`{id, ok, …}`). */
function fakeHelpers() {
  const spawned: FakeHelper[] = [];
  type FakeHelper = {
    commands: Array<Record<string, any>>;
    killed: boolean;
    reply(id: number, body: Record<string, unknown>): void;
    send(message: Record<string, unknown>): void;
    die(code?: number): void;
    autoReply: boolean;
  };
  const spawnHelper = (): BrowserProcess => {
    const lineCbs: Array<(line: string) => void> = [];
    const exitCbs: Array<(code: number | null, message?: string) => void> = [];
    const helper: FakeHelper = {
      commands: [],
      killed: false,
      autoReply: true,
      reply: (id, body) => { for (const cb of lineCbs) cb(JSON.stringify({ id, ...body })); },
      send: (message) => { for (const cb of lineCbs) cb(JSON.stringify(message)); },
      die: (code = 1) => { for (const cb of exitCbs) cb(code); },
    };
    spawned.push(helper);
    return {
      write(line) {
        const command = JSON.parse(line) as Record<string, any>;
        helper.commands.push(command);
        if (helper.autoReply) setImmediate(() => helper.reply(command.id, { ok: true, op: command.op }));
      },
      onLine: (cb) => { lineCbs.push(cb); },
      onExit: (cb) => { exitCbs.push(cb); },
      kill() {
        helper.killed = true;
        setImmediate(() => { for (const cb of exitCbs) cb(0); });
      },
    };
  };
  return { spawned, spawnHelper };
}

test('driver: starts nothing until the first request; one helper process serves every request', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper, idleMs: 10_000 });
  assert.equal(fake.spawned.length, 0);
  assert.equal(driver.isRunning(), false);

  const [a, b] = await Promise.all([
    driver.request('open', { page: 'chat-1', url: 'https://example.com/' }),
    driver.request('list'),
  ]);
  assert.equal(fake.spawned.length, 1, 'one process for both');
  assert.equal(driver.isRunning(), true);
  assert.equal(a.op, 'open');
  assert.equal(b.op, 'list');
  const [first, second] = fake.spawned[0].commands;
  assert.deepEqual(first, { id: first.id, op: 'open', page: 'chat-1', url: 'https://example.com/' });
  assert.notEqual(first.id, second.id, 'every command has its own id');
  driver.stop();
});

test('driver: an error reply rejects with BrowserError carrying the helper code; ok/id are not in the result', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper });
  const result = await driver.request('click', { page: 'chat-1', selector: '#x' });
  assert.equal(result.op, 'click');
  assert.equal('ok' in result, false);
  assert.equal('id' in result, false);

  const helper = fake.spawned[0];
  helper.autoReply = false;
  const failing = driver.request('click', { page: 'chat-1', selector: '#nope' });
  await sleep(0);
  helper.reply(helper.commands[1].id, { ok: false, error: 'no_element', message: 'element not found' });
  await assert.rejects(failing, (error: unknown) => error instanceof BrowserError && error.code === 'no_element' && /not found/.test(error.message));
  driver.stop();
});

test('driver: no requests and no viewers for idleMs → the helper is stopped; a passive request does not keep it', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper, idleMs: 60 });
  await driver.request('open', { page: 'chat-1', url: 'https://example.com/' });
  await sleep(35);
  await driver.request('list', {}, { passive: true });
  await sleep(45);
  assert.equal(fake.spawned[0].killed, true, 'passive poll did not extend the life');
  assert.equal(driver.isRunning(), false);

  // A real request after the unload starts a new process.
  await driver.request('list');
  assert.equal(fake.spawned.length, 2);
  await sleep(30);
  await driver.request('click', { page: 'chat-1', x: 1, y: 1 });
  await sleep(40);
  assert.equal(fake.spawned[1].killed, false, 'a real request extends the life');
  await sleep(50);
  assert.equal(fake.spawned[1].killed, true);
});

test('driver: frames go only to viewers of that page; a viewer keeps the helper loaded; the last viewer leaving unwatches', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper, idleMs: 40, watchFps: 3 });
  await driver.request('open', { page: 'chat-1', url: 'https://example.com/' });
  const seenA: string[] = [];
  const seenB: string[] = [];
  const stopA = driver.watch('chat-1', (jpeg) => seenA.push(jpeg.toString()));
  const stopB = driver.watch('chat-1', (jpeg) => seenB.push(jpeg.toString()));
  await sleep(0);
  const helper = fake.spawned[0];
  const watches = helper.commands.filter((command) => command.op === 'watch');
  assert.deepEqual(watches.map((command) => [command.page, command.fps]), [['chat-1', 3]], 'one watch per page');

  helper.send({ event: 'frame', page: 'chat-1', jpeg: Buffer.from('FRAME-1').toString('base64') });
  helper.send({ event: 'frame', page: 'chat-2', jpeg: Buffer.from('OTHER').toString('base64') });
  assert.deepEqual(seenA, ['FRAME-1']);
  assert.deepEqual(seenB, ['FRAME-1']);

  await sleep(80);
  assert.equal(helper.killed, false, 'watched page keeps the helper');

  stopA();
  helper.send({ event: 'frame', page: 'chat-1', jpeg: Buffer.from('FRAME-2').toString('base64') });
  assert.deepEqual(seenA, ['FRAME-1']);
  assert.deepEqual(seenB, ['FRAME-1', 'FRAME-2']);
  assert.equal(helper.commands.some((command) => command.op === 'unwatch'), false);
  stopB();
  stopB();
  await sleep(0);
  assert.deepEqual(helper.commands.filter((command) => command.op === 'unwatch').map((command) => command.page), ['chat-1']);
  await sleep(80);
  assert.equal(helper.killed, true, 'no viewers, no requests → unloaded');
});

test('driver: events are passed on; a dead helper rejects pending requests, reports exit and the next call starts a new one', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper, idleMs: 10_000 });
  const events: BrowserEvent[] = [];
  driver.onEvent((event) => events.push(event));
  await driver.request('open', { page: 'chat-1', url: 'https://example.com/' });
  const helper = fake.spawned[0];
  helper.send({ event: 'navigated', page: 'chat-1', url: 'https://example.com/next', title: 'Next' });
  helper.send({ event: 'closed', page: 'chat-1' });
  helper.send({ event: 'frame', page: 'chat-1', jpeg: 'AAAA' });

  helper.autoReply = false;
  const pending = driver.request('read', { page: 'chat-1', format: 'text' });
  await sleep(0);
  helper.die(9);
  await assert.rejects(pending, (error: unknown) => error instanceof BrowserError && error.code === 'helper_exit');
  assert.equal(driver.isRunning(), false);
  assert.deepEqual(events, [
    { event: 'navigated', page: 'chat-1', url: 'https://example.com/next', title: 'Next' },
    { event: 'closed', page: 'chat-1' },
    { event: 'exit', reason: 'died', code: 9 },
  ]);

  await driver.request('list');
  assert.equal(fake.spawned.length, 2, 'restarted');
  driver.stop();
  await sleep(0);
  assert.deepEqual(events.at(-1), { event: 'exit', reason: 'stopped', code: null });
  assert.equal(events.filter((event) => event.event === 'exit').length, 2, 'the stopped process reports once');
});

test('driver: the helper cannot be started → BrowserError helper_missing, nothing running', async () => {
  const driver = createBrowserDriver({ spawnHelper: () => { throw new Error('no binary'); } });
  await assert.rejects(driver.request('list'), (error: unknown) => error instanceof BrowserError && error.code === 'helper_missing');
  assert.equal(driver.isRunning(), false);
  const stop = driver.watch('chat-1', () => {});
  stop();
});

test('driver: a reply that never comes rejects with timeout, the process stays', async () => {
  const fake = fakeHelpers();
  const driver = createBrowserDriver({ spawnHelper: fake.spawnHelper, requestTimeoutMs: 30 });
  await driver.request('list');
  fake.spawned[0].autoReply = false;
  await assert.rejects(driver.request('wait', { page: 'chat-1', ms: 10 }), (error: unknown) => error instanceof BrowserError && error.code === 'timeout');
  assert.equal(driver.isRunning(), true);
  driver.stop();
});
