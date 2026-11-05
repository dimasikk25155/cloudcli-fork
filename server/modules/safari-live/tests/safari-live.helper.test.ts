import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { spawnBrowserHelper } from '../safari-live.helper.js';

// A stand-in for `neo3-browser serve` (interfaces.md part 2 §A): JSON command lines on
// stdin, JSON reply lines on stdout. Replies are written in awkward pieces (inside a
// line, inside a multi-byte letter) to check the line reader.
const FAKE_HELPER = String.raw`
if (process.argv[2] !== 'serve') process.exit(2);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    const reply = Buffer.from(JSON.stringify({ id: command.id, ok: true, title: 'Пример — страница' }) + '\n' + JSON.stringify({ event: 'navigated', page: 'p', url: 'https://example.com/', title: 'Ёж' }) + '\n');
    const cut = reply.indexOf(Buffer.from('ример')) + 1; // inside the two-byte «р»
    process.stdout.write(reply.subarray(0, cut));
    setTimeout(() => process.stdout.write(reply.subarray(cut)), 15);
  }
});
process.stdin.on('end', () => setTimeout(() => process.exit(0), 10));
`;

test('helper process: command lines in, reply and event lines out (split chunks, UTF-8); kill closes stdin → exit 0', { timeout: 5_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'neo3-browser-helper-'));
  try {
    const script = path.join(directory, 'fake-browser.mjs');
    await writeFile(script, FAKE_HELPER);
    const child = spawnBrowserHelper(process.execPath, [script]);
    const lines: string[] = [];
    const exited = new Promise<number | null>((resolve) => child.onExit((code) => resolve(code)));
    const gotTwo = new Promise<void>((resolve) => child.onLine((line) => { lines.push(line); if (lines.length === 2) resolve(); }));
    child.write(JSON.stringify({ id: 1, op: 'list' }));
    await gotTwo;
    assert.deepEqual(JSON.parse(lines[0]), { id: 1, ok: true, title: 'Пример — страница' });
    assert.deepEqual(JSON.parse(lines[1]), { event: 'navigated', page: 'p', url: 'https://example.com/', title: 'Ёж' });
    child.kill();
    assert.equal(await exited, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('helper process: a binary that is not there → spawn throws (the driver reports helper_missing)', () => {
  assert.throws(() => spawnBrowserHelper(path.join(tmpdir(), 'no-such-neo3-browser-binary')), /не установлен|not installed/);
});
