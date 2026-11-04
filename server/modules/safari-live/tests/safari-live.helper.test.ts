import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHelperRunners } from '@/modules/safari-live/index.js';
import type { SafariRect, StreamEnd } from '@/modules/safari-live/index.js';

// A stand-in for `neo3-safari-capture` that speaks the helper protocol of
// interfaces.md §1: `list` JSON, `stream` [UInt32 BE length][JPEG]…, `display`
// ready line, `place` {"ok":true}; errors as one JSON line on stderr + exit code.
const FAKE_HELPER = String.raw`
const [cmd, ...rest] = process.argv.slice(2);
const waitStdinEnd = (code) => { process.stdin.on('data', () => {}); process.stdin.on('end', () => process.exit(code)); };
if (cmd === 'list') {
  if (process.env.FAKE_DENY === '1') { process.stdout.write('{"permission":false,"windows":[]}\n'); process.exit(3); }
  process.stdout.write(JSON.stringify({ permission: true, windows: [{ windowId: 51, title: 'Пример', onScreen: true, width: 1280, height: 800 }] }) + '\n');
  process.exit(0);
}
if (cmd === 'stream') {
  const id = rest[0];
  const frames = ['jpeg-one', 'jpeg-two-longer', 'x'].map((text) => {
    const body = Buffer.from(text);
    const head = Buffer.alloc(4); head.writeUInt32BE(body.length, 0);
    return Buffer.concat([head, body]);
  });
  const all = Buffer.concat(frames);
  // Split at awkward places: inside a length prefix and inside a body.
  process.stdout.write(all.subarray(0, 2));
  setTimeout(() => process.stdout.write(all.subarray(2, 9)), 10);
  setTimeout(() => process.stdout.write(all.subarray(9)), 20);
  setTimeout(() => {
    if (id === '404') { process.stderr.write('{"error":"window_gone","message":"окно закрыто"}\n'); process.exit(4); }
    if (id === '403') { process.stderr.write('{"error":"no_permission","message":"нет записи экрана"}\n'); process.exit(3); }
    waitStdinEnd(0);
  }, 40);
} else if (cmd === 'display') {
  process.stdout.write('{"event":"creating"}\n');
  setTimeout(() => process.stdout.write('{"ready":true,"displayId":5,"bounds":{"x":2560,"y":1440,"width":1920,"height":1200}}\n'), 15);
  waitStdinEnd(0);
} else if (cmd === 'place') {
  if (rest[0] === '404') { process.stderr.write('{"error":"window_gone","message":"нет окна"}\n'); process.exit(4); }
  process.stdout.write(JSON.stringify({ ok: true, args: rest }) + '\n');
  process.exit(0);
}
`;

async function withFakeHelper(run: (runners: ReturnType<typeof createHelperRunners>, setEnv: (env: NodeJS.ProcessEnv) => void) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'safari-helper-'));
  const script = path.join(directory, 'fake-helper.mjs');
  await writeFile(script, FAKE_HELPER);
  let env: NodeJS.ProcessEnv = {};
  const runners = createHelperRunners(process.execPath, [script], () => ({ ...process.env, ...env }));
  try {
    await run(runners, (next) => { env = next; });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function collectStream(runners: ReturnType<typeof createHelperRunners>, windowId: number, stopAfterFrames?: number) {
  return new Promise<{ frames: string[]; end: StreamEnd; message?: string }>((resolve) => {
    const frames: string[] = [];
    const child = runners.spawnStream(windowId, { fps: 3, maxWidth: 1280, quality: 0.6 });
    child.onFrame((jpeg) => {
      frames.push(jpeg.toString());
      if (stopAfterFrames && frames.length === stopAfterFrames) child.stop();
    });
    child.onExit((end, message) => resolve({ frames, end, message }));
  });
}

test('helper protocol: list JSON and exit code 3 without permission', async () => {
  await withFakeHelper(async (runners, setEnv) => {
    const ok = await runners.runList();
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.stdout).windows[0].windowId, 51);

    setEnv({ FAKE_DENY: '1' });
    const denied = await runners.runList();
    assert.equal(denied.code, 3);
    assert.equal(JSON.parse(denied.stdout).permission, false);
  });
});

test('helper protocol: length-prefixed frames are reassembled across chunks; stop() closes stdin → stopped', async () => {
  await withFakeHelper(async (runners) => {
    const result = await collectStream(runners, 51, 3);
    assert.deepEqual(result.frames, ['jpeg-one', 'jpeg-two-longer', 'x']);
    assert.equal(result.end, 'stopped');
  });
});

test('helper protocol: exit 4 → window_gone, exit 3 → no_permission, with the helper message', async () => {
  await withFakeHelper(async (runners) => {
    const gone = await collectStream(runners, 404);
    assert.equal(gone.frames.length, 3);
    assert.equal(gone.end, 'window_gone');
    assert.equal(gone.message, 'окно закрыто');

    const denied = await collectStream(runners, 403);
    assert.equal(denied.end, 'no_permission');
  });
});

test('helper protocol: display reports bounds from its ready line and exits 0 on stop; place passes the rect', async () => {
  await withFakeHelper(async (runners) => {
    const display = runners.spawnDisplay();
    const bounds = await new Promise<SafariRect>((resolve) => display.onReady(resolve));
    assert.deepEqual(bounds, { x: 2560, y: 1440, width: 1920, height: 1200 });
    const exited = new Promise<number>((resolve) => display.onExit((code) => resolve(code)));
    display.stop();
    assert.equal(await exited, 0);

    const placed = await runners.runPlace(51, { x: 2560, y: 1440, width: 1920, height: 1200 });
    assert.equal(placed.code, 0);
    assert.deepEqual(JSON.parse(placed.stdout).args, ['51', '--x', '2560', '--y', '1440', '--width', '1920', '--height', '1200']);

    const gone = await runners.runPlace(404, { x: 0, y: 0, width: 100, height: 100 });
    assert.equal(gone.code, 4);
  });
});

test('helper protocol: a missing binary answers code 127 instead of throwing', async () => {
  const runners = createHelperRunners(path.join(tmpdir(), 'no-such-dir', 'neo3-safari-capture'));
  assert.equal((await runners.runList()).code, 127);
  assert.equal((await runners.runPlace(1, { x: 0, y: 0, width: 1, height: 1 })).code, 127);
  assert.throws(() => runners.spawnStream(1, { fps: 3, maxWidth: 1280, quality: 0.6 }), /не установлен/);
  assert.throws(() => runners.spawnDisplay(), /не установлен/);
});
