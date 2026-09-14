import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INPUT_HISTORY_STORAGE_KEY,
  appendInputHistory,
  applyHistoryKey,
  readInputHistory,
  type HistoryNav,
} from './useInputHistory.js';

const memory = new Map<string, string>();

function installLocalStorage(): void {
  memory.clear();
  const localStorageMock = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

test('records sent messages and recalls them newest-first on ArrowUp', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'first message');
  appendInputHistory('session-1', 'second message');
  assert.deepEqual(readInputHistory('session-1'), ['first message', 'second message']);

  let nav: HistoryNav | null = null;
  const up1 = applyHistoryKey({ key: 'ArrowUp', value: '' }, nav, 'session-1');
  assert.equal(up1.handled, true);
  assert.equal(up1.nextInput, 'second message');
  nav = up1.nav;

  const up2 = applyHistoryKey({ key: 'ArrowUp', value: 'second message' }, nav, 'session-1');
  assert.equal(up2.nextInput, 'first message');
  nav = up2.nav;

  const up3 = applyHistoryKey({ key: 'ArrowUp', value: 'first message' }, nav, 'session-1');
  assert.equal(up3.handled, true);
  assert.equal(up3.nextInput, undefined);
});

test('walks forward with ArrowDown and finally restores the draft', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'first message');
  appendInputHistory('session-1', 'second message');

  let nav: HistoryNav | null = null;
  nav = applyHistoryKey({ key: 'ArrowUp', value: '' }, nav, 'session-1').nav;
  nav = applyHistoryKey({ key: 'ArrowUp', value: 'second message' }, nav, 'session-1').nav;
  const down1 = applyHistoryKey({ key: 'ArrowDown', value: 'first message' }, nav, 'session-1');
  assert.equal(down1.nextInput, 'second message');
  nav = down1.nav;
  const down2 = applyHistoryKey({ key: 'ArrowDown', value: 'second message' }, nav, 'session-1');
  assert.equal(down2.nextInput, '');
  assert.equal(down2.nav, null);
});

test('keeps each chat scope separate', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'for session one');
  appendInputHistory('session-2', 'for session two');
  assert.deepEqual(readInputHistory('session-1'), ['for session one']);
  assert.deepEqual(readInputHistory('session-2'), ['for session two']);

  const up = applyHistoryKey({ key: 'ArrowUp', value: '' }, null, 'session-1');
  assert.equal(up.nextInput, 'for session one');

  const none = applyHistoryKey({ key: 'ArrowUp', value: '' }, null, null);
  assert.equal(none.handled, false);
});

test('keeps walking the snapshot taken when recall started, even if storage changes', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'only message');
  const started = applyHistoryKey({ key: 'ArrowUp', value: '' }, null, 'session-1');
  assert.equal(started.nextInput, 'only message');

  memory.set(
    INPUT_HISTORY_STORAGE_KEY,
    JSON.stringify({ 'session-1': ['only message', 'from another tab'] }),
  );
  const down = applyHistoryKey(
    { key: 'ArrowDown', value: 'only message' },
    started.nav,
    'session-1',
  );
  assert.equal(down.nextInput, '');
});

test('leaves the arrows alone while the user is editing text', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'a message');

  const up = applyHistoryKey({ key: 'ArrowUp', value: 'draft in progress' }, null, 'session-1');
  assert.equal(up.handled, false);

  const recalled = applyHistoryKey({ key: 'ArrowUp', value: '' }, null, 'session-1');
  const edited = applyHistoryKey(
    { key: 'ArrowUp', value: 'a message, edited' },
    recalled.nav,
    'session-1',
  );
  assert.equal(edited.handled, false);

  const shifted = applyHistoryKey(
    { key: 'ArrowUp', value: '', shiftKey: true },
    null,
    'session-1',
  );
  assert.equal(shifted.handled, false);
});

test('skips consecutive-duplicate entries and caps entries per scope', () => {
  installLocalStorage();
  appendInputHistory('session-1', 'same');
  appendInputHistory('session-1', 'same');
  assert.deepEqual(readInputHistory('session-1'), ['same']);

  for (let i = 0; i < 150; i += 1) {
    appendInputHistory('session-1', `message ${i}`);
  }
  const history = readInputHistory('session-1');
  assert.equal(history.length, 100);
  assert.equal(history[history.length - 1], 'message 149');
});

test('evicts the oldest-written scopes past the scope cap', () => {
  installLocalStorage();
  for (let i = 0; i < 105; i += 1) {
    appendInputHistory(`session-${i}`, `message ${i}`);
  }
  appendInputHistory('session-5', 'kept alive');
  appendInputHistory('session-200', 'one more');

  assert.deepEqual(readInputHistory('session-5'), ['message 5', 'kept alive']);
  assert.deepEqual(readInputHistory('session-200'), ['one more']);
  assert.deepEqual(readInputHistory('session-6'), []);
});

test('ignores a corrupt or pre-scoped stored history', () => {
  installLocalStorage();
  memory.set(INPUT_HISTORY_STORAGE_KEY, '{not json');
  assert.deepEqual(readInputHistory('session-1'), []);

  memory.set(INPUT_HISTORY_STORAGE_KEY, JSON.stringify(['legacy entry']));
  assert.deepEqual(readInputHistory('session-1'), []);

  const up = applyHistoryKey({ key: 'ArrowUp', value: '' }, null, 'session-1');
  assert.equal(up.handled, false);
});
