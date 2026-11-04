import assert from 'node:assert/strict';
import test from 'node:test';

import { createKeepAwake } from '@/modules/keep-awake/keep-awake.service.js';

// Values from the spec, not from the code: 2 minutes and 3 hours.
const KEEP_AWAKE_RELEASE_MS = 120_000;
const KEEP_AWAKE_MAX_IDLE_MS = 3 * 60 * 60 * 1000;

function setup(platform: NodeJS.Platform = 'darwin', isModOn?: (id: number | null) => boolean) {
  let time = 1_000_000;
  const spawned: Array<{ command: string; args: string[]; killed: boolean }> = [];
  const service = createKeepAwake({
    platform,
    pid: 777,
    now: () => time,
    isModOn,
    spawn: (command, args) => {
      const record = { command, args, killed: false };
      spawned.push(record);
      return { kill: () => { record.killed = true; }, on: () => {} };
    },
  });
  return { service, spawned, advance: (ms: number) => { time += ms; } };
}

const change = (sessionId: string, state: 'working' | 'done', userId: number | null = 1) => ({ sessionId, state, userId });

test('a working run starts caffeinate bound to the server pid, once', () => {
  const { service, spawned } = setup();
  service.onChange(change('a', 'working'));
  service.onChange(change('b', 'working'));
  assert.equal(spawned.length, 1);
  assert.deepEqual([spawned[0].command, spawned[0].args], ['caffeinate', ['-i', '-w', '777']]);
});

test('no working run for 2 minutes releases the process; a new run in between keeps it', () => {
  const { service, spawned, advance } = setup();
  service.onChange(change('a', 'working'));
  service.onChange(change('a', 'done'));
  advance(KEEP_AWAKE_RELEASE_MS - 1000);
  service.tick();
  assert.equal(spawned[0].killed, false);
  service.onChange(change('a', 'working'));
  service.onChange(change('a', 'done'));
  advance(KEEP_AWAKE_RELEASE_MS - 1000);
  service.tick();
  assert.equal(spawned[0].killed, false);
  advance(2000);
  service.tick();
  assert.equal(spawned[0].killed, true);
  assert.equal(service.isHolding(), false);
});

test('still working: held, but dropped after 3 hours without new activity', () => {
  const { service, spawned, advance } = setup();
  service.onChange(change('a', 'working'));
  advance(KEEP_AWAKE_RELEASE_MS * 5);
  service.tick();
  assert.equal(spawned[0].killed, false);
  advance(KEEP_AWAKE_MAX_IDLE_MS);
  service.tick();
  assert.equal(spawned[0].killed, true);
  service.onChange(change('c', 'working'));
  assert.equal(spawned.length, 2);
});

test('not macOS: nothing is spawned; mod off for the owner: nothing is spawned', () => {
  const linux = setup('linux');
  linux.service.onChange(change('a', 'working'));
  assert.equal(linux.spawned.length, 0);
  const off = setup('darwin', (id) => id !== 1);
  off.service.onChange(change('a', 'working', 1));
  assert.equal(off.spawned.length, 0);
  off.service.onChange(change('b', 'working', 2));
  assert.equal(off.spawned.length, 1);
});
