import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autopilotRunKey,
  markAutoOpened,
  shouldAutoOpenAutopilot,
  wasAutoOpened,
  type AutoOpenStorage,
} from './autopilotAutoOpen.js';

function memoryStorage(): AutoOpenStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test('a running build opens the tab once', () => {
  const runKey = autopilotRunKey('p1', 'Сайт');
  assert.equal(shouldAutoOpenAutopilot({ available: true, finished: false, runKey, alreadyOpened: false }), true);
  assert.equal(shouldAutoOpenAutopilot({ available: true, finished: false, runKey, alreadyOpened: true }), false);
});

test('no run, a finished run or a run without a title opens nothing', () => {
  const runKey = autopilotRunKey('p1', 'Сайт');
  assert.equal(shouldAutoOpenAutopilot({ available: false, finished: false, runKey, alreadyOpened: false }), false);
  assert.equal(shouldAutoOpenAutopilot({ available: true, finished: true, runKey, alreadyOpened: false }), false);
  assert.equal(autopilotRunKey('p1', null), null);
  assert.equal(shouldAutoOpenAutopilot({ available: true, finished: false, runKey: null, alreadyOpened: false }), false);
});

test('opened runs are remembered per project and title', () => {
  const storage = memoryStorage();
  const first = autopilotRunKey('p1', 'Сайт')!;
  const other = autopilotRunKey('p2', 'Сайт')!;
  assert.equal(wasAutoOpened(first, storage), false);
  markAutoOpened(first, storage);
  assert.equal(wasAutoOpened(first, storage), true);
  assert.equal(wasAutoOpened(other, storage), false);
});

test('broken storage is treated as empty', () => {
  const storage = memoryStorage();
  storage.setItem('neo3.autopilot.autoOpened', '{oops');
  assert.equal(wasAutoOpened('p1::x', storage), false);
  markAutoOpened('p1::x', storage);
  assert.equal(wasAutoOpened('p1::x', storage), true);
});
