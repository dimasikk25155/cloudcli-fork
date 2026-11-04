import assert from 'node:assert/strict';
import test from 'node:test';

import { createSafariLiveService } from '@/modules/safari-live/index.js';
import type {
  DisplayProcess,
  HelperResult,
  SafariRect,
  StreamEnd,
  StreamProcess,
} from '@/modules/safari-live/index.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, what: string, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** Fake `stream` child: the test pushes frames and exits by hand. */
class FakeStream implements StreamProcess {
  frameCbs: Array<(jpeg: Buffer) => void> = [];
  exitCbs: Array<(end: StreamEnd, message?: string) => void> = [];
  stopped = 0;
  onFrame(cb: (jpeg: Buffer) => void) { this.frameCbs.push(cb); }
  onExit(cb: (end: StreamEnd, message?: string) => void) { this.exitCbs.push(cb); }
  stop() { this.stopped += 1; }
  frame(text: string) { for (const cb of this.frameCbs) cb(Buffer.from(text)); }
  exit(end: StreamEnd, message?: string) { for (const cb of this.exitCbs) cb(end, message); }
}

class FakeDisplay implements DisplayProcess {
  readyCbs: Array<(bounds: SafariRect) => void> = [];
  exitCbs: Array<(code: number, message?: string) => void> = [];
  stopped = 0;
  onReady(cb: (bounds: SafariRect) => void) { this.readyCbs.push(cb); }
  onExit(cb: (code: number, message?: string) => void) { this.exitCbs.push(cb); }
  stop() { this.stopped += 1; }
  ready(bounds: SafariRect) { for (const cb of this.readyCbs) cb(bounds); }
  exit(code: number, message?: string) { for (const cb of this.exitCbs) cb(code, message); }
}

const listOk = (windows: unknown[]): HelperResult => ({ code: 0, stdout: `${JSON.stringify({ permission: true, windows })}\n`, stderr: '' });

const WINDOWS = [
  { windowId: 120, title: 'Яндекс', onScreen: true, width: 1280, height: 800 },
  { windowId: 345, title: 'GitHub — Pull Request', onScreen: false, width: 1440, height: 900 },
  { windowId: 200, title: 'github.com/docs', onScreen: true, width: 1000, height: 700 },
];

test('not a Mac: every call answers «unsupported» and no helper process is started', async () => {
  let started = 0;
  const service = createSafariLiveService({
    platform: 'linux',
    runList: async () => { started += 1; return listOk(WINDOWS); },
    spawnStream: () => { started += 1; return new FakeStream(); },
    spawnDisplay: () => { started += 1; return new FakeDisplay(); },
    runPlace: async () => { started += 1; return { code: 0, stdout: '{"ok":true}', stderr: '' }; },
  });

  assert.equal((await service.listWindows()).state, 'unsupported');
  assert.equal((await service.pickWindow()).window, null);
  const display = await service.ensureDisplay();
  assert.equal(display.ok, false);
  assert.equal(display.ok === false && display.state, 'unsupported');
  assert.equal((await service.placeOnDisplay(120)).ok, false);

  const ends: StreamEnd[] = [];
  service.subscribe(120, { onFrame: () => assert.fail('no frames off a Mac'), onEnd: (end) => ends.push(end) });
  await waitFor(() => ends.length > 0, 'the end of the stream');
  assert.deepEqual(ends, ['error']);
  assert.equal(service.activeStreams(), 0);
  assert.equal(started, 0);
});

test('listWindows: helper JSON → windows; no permission, a missing helper and garbage become states, not exceptions', async () => {
  let reply: HelperResult | Error = listOk(WINDOWS);
  let clock = 1_000;
  let calls = 0;
  const service = createSafariLiveService({
    platform: 'darwin',
    now: () => clock,
    listCacheMs: 2_000,
    runList: async () => {
      calls += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });

  const ok = await service.listWindows();
  assert.equal(ok.state, 'ok');
  assert.deepEqual(ok.windows.map((window) => window.windowId), [120, 345, 200]);
  assert.equal(ok.windows[1].title, 'GitHub — Pull Request');

  // Within the cache window the helper is not asked again.
  clock += 1_500;
  await service.listWindows();
  assert.equal(calls, 1);

  clock += 1_000;
  reply = { code: 3, stdout: '{"permission":false,"windows":[]}\n', stderr: '' };
  const denied = await service.listWindows();
  assert.equal(denied.state, 'no_permission');
  assert.deepEqual(denied.windows, []);
  assert.equal(calls, 2);

  clock += 5_000;
  reply = { code: 127, stdout: '', stderr: '' };
  const missing = await service.listWindows();
  assert.equal(missing.state, 'error');
  assert.match(missing.message ?? '', /помощник не установлен/);

  clock += 5_000;
  reply = { code: 0, stdout: 'not json', stderr: '' };
  assert.equal((await service.listWindows()).state, 'error');

  clock += 5_000;
  reply = new Error('spawn EACCES');
  const failed = await service.listWindows();
  assert.equal(failed.state, 'error');
  assert.deepEqual(failed.windows, []);
});

test('pickWindow: newest window (largest id), or the newest whose title contains the text, any case', async () => {
  const service = createSafariLiveService({ platform: 'darwin', runList: async () => listOk(WINDOWS) });

  assert.equal((await service.pickWindow()).window?.windowId, 345);
  assert.equal((await service.pickWindow('GITHUB')).window?.windowId, 345);
  assert.equal((await service.pickWindow('docs')).window?.windowId, 200);
  assert.equal((await service.pickWindow('яндекс')).window?.windowId, 120);
  const none = await service.pickWindow('нет такого');
  assert.equal(none.window, null);
  assert.equal(none.list.state, 'ok');

  const empty = createSafariLiveService({ platform: 'darwin', runList: async () => listOk([]) });
  assert.equal((await empty.pickWindow()).window, null);
});

test('subscribe: one process per window for all viewers, a late viewer gets the last frame, idle stop after the last one leaves', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawned: Array<{ windowId: number; opts: unknown; process: FakeStream }> = [];
  const service = createSafariLiveService({
    platform: 'darwin',
    idleMs: 20_000,
    spawnStream: (windowId, opts) => {
      const process = new FakeStream();
      spawned.push({ windowId, opts, process });
      return process;
    },
  });

  const first: string[] = [];
  const second: string[] = [];
  const offFirst = service.subscribe(345, { onFrame: (jpeg) => first.push(jpeg.toString()), onEnd: () => {} });
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].opts, { fps: 3, maxWidth: 1280, quality: 0.6 });
  spawned[0].process.frame('frame-1');

  const offSecond = service.subscribe(345, { onFrame: (jpeg) => second.push(jpeg.toString()), onEnd: () => {} });
  assert.equal(spawned.length, 1, 'the second viewer shares the process');
  assert.deepEqual(second, ['frame-1'], 'a new viewer sees the last frame at once');

  spawned[0].process.frame('frame-2');
  assert.deepEqual(first, ['frame-1', 'frame-2']);
  assert.deepEqual(second, ['frame-1', 'frame-2']);
  assert.equal(service.activeStreams(), 1);

  offFirst();
  offSecond();
  // A viewer coming back inside the idle window keeps the same process.
  t.mock.timers.tick(10_000);
  const offThird = service.subscribe(345, { onFrame: () => {}, onEnd: () => {} });
  t.mock.timers.tick(30_000);
  assert.equal(spawned[0].process.stopped, 0);
  assert.equal(spawned.length, 1);

  offThird();
  t.mock.timers.tick(19_000);
  assert.equal(spawned[0].process.stopped, 0, 'not before idleMs');
  t.mock.timers.tick(1_500);
  assert.equal(spawned[0].process.stopped, 1);
  assert.equal(service.activeStreams(), 0);

  // A later viewer starts a fresh process.
  service.subscribe(345, { onFrame: () => {}, onEnd: () => {} });
  assert.equal(spawned.length, 2);
  service.stopAll();
  assert.equal(spawned[1].process.stopped, 1);
});

test('subscribe: a window that disappears ends every viewer with window_gone; a helper that fails to start ends with error', async () => {
  const spawned: FakeStream[] = [];
  let failSpawn = false;
  const service = createSafariLiveService({
    platform: 'darwin',
    spawnStream: () => {
      if (failSpawn) throw new Error('spawn ENOENT');
      const process = new FakeStream();
      spawned.push(process);
      return process;
    },
  });

  const ends: Array<[StreamEnd, string | undefined]> = [];
  service.subscribe(7, { onFrame: () => {}, onEnd: (end, message) => ends.push([end, message]) });
  service.subscribe(7, { onFrame: () => {}, onEnd: (end, message) => ends.push([end, message]) });
  spawned[0].exit('window_gone', 'окно закрыто');
  assert.deepEqual(ends, [['window_gone', 'окно закрыто'], ['window_gone', 'окно закрыто']]);
  assert.equal(service.activeStreams(), 0);

  failSpawn = true;
  const failed: StreamEnd[] = [];
  assert.doesNotThrow(() => service.subscribe(8, { onFrame: () => {}, onEnd: (end) => failed.push(end) }));
  await waitFor(() => failed.length > 0, 'the end of the stream');
  assert.deepEqual(failed, ['error']);
  assert.equal(service.activeStreams(), 0);
});

test('ensureDisplay: the virtual display is created once per server life; a dead one is recreated on the next call', async () => {
  const displays: FakeDisplay[] = [];
  const service = createSafariLiveService({
    platform: 'darwin',
    spawnDisplay: () => {
      const display = new FakeDisplay();
      displays.push(display);
      return display;
    },
  });
  const bounds = { x: 2560, y: 1440, width: 1920, height: 1200 };

  const pendingA = service.ensureDisplay();
  const pendingB = service.ensureDisplay();
  assert.equal(displays.length, 1, 'concurrent calls share one process');
  displays[0].ready(bounds);
  assert.deepEqual(await pendingA, { ok: true, bounds });
  assert.deepEqual(await pendingB, { ok: true, bounds });

  // A second safari.show does not recreate the display.
  assert.deepEqual(await service.ensureDisplay(), { ok: true, bounds });
  assert.equal(displays.length, 1);

  // The process died → the next call creates a new display.
  displays[0].exit(1, 'crashed');
  const again = service.ensureDisplay();
  assert.equal(displays.length, 2);
  displays[1].ready({ ...bounds, x: 1470 });
  assert.deepEqual(await again, { ok: true, bounds: { ...bounds, x: 1470 } });

  // stopAll removes the display (the helper hides Safari before that).
  service.stopAll();
  assert.equal(displays[1].stopped, 1);
});

test('ensureDisplay: a helper that exits before ready (layout not restored) is a state with a message, and the next call retries', async () => {
  const displays: FakeDisplay[] = [];
  const service = createSafariLiveService({
    platform: 'darwin',
    spawnDisplay: () => {
      const display = new FakeDisplay();
      displays.push(display);
      return display;
    },
  });

  const first = service.ensureDisplay();
  displays[0].exit(5, 'раскладка мониторов не восстановилась');
  const result = await first;
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.state, 'error');
  assert.match(result.ok === false ? result.message : '', /раскладка/);

  void service.ensureDisplay();
  assert.equal(displays.length, 2);
  service.stopAll();
});

test('placeOnDisplay: the window fills the display; a closed window is window_gone; no display → not ok', async () => {
  const places: Array<{ windowId: number; rect: SafariRect }> = [];
  let placeCode = 0;
  let displayFails = false;
  const service = createSafariLiveService({
    platform: 'darwin',
    spawnDisplay: () => {
      const display = new FakeDisplay();
      setImmediate(() => (displayFails ? display.exit(5, 'нет экрана') : display.ready({ x: 2560, y: 1440, width: 1920, height: 1200 })));
      return display;
    },
    runPlace: async (windowId, rect) => {
      places.push({ windowId, rect });
      return placeCode === 0
        ? { code: 0, stdout: '{"ok":true}\n', stderr: '' }
        : { code: placeCode, stdout: '', stderr: '{"error":"window_gone","message":"нет окна"}\n' };
    },
  });

  assert.deepEqual(await service.placeOnDisplay(345), { ok: true });
  assert.deepEqual(places, [{ windowId: 345, rect: { x: 2560, y: 1440, width: 1920, height: 1200 } }]);

  placeCode = 4;
  const gone = await service.placeOnDisplay(999);
  assert.equal(gone.ok, false);
  assert.equal(gone.end, 'window_gone');

  service.stopAll();
  displayFails = true;
  const noDisplay = await service.placeOnDisplay(345);
  assert.equal(noDisplay.ok, false);
  assert.ok(noDisplay.message);
  assert.equal(places.length, 2, 'nothing is moved without a display');
});
