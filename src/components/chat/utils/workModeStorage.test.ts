import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FALLBACK_WORK_MODE,
  WORK_MODE_DEFAULT_KEY,
  readDefaultWorkMode,
  readSessionWorkMode,
  workModeStorageKey,
} from './workModeStorage.js';

const storageWith = (entries: Record<string, string>) => ({
  getItem: (key: string) => entries[key] ?? null,
});

test('a chat with its own record uses it, ignoring the account default', () => {
  const storage = storageWith({
    [WORK_MODE_DEFAULT_KEY]: 'autopilot',
    [workModeStorageKey('chat-1')]: 'checkpoints',
  });
  assert.equal(readSessionWorkMode('chat-1', storage), 'checkpoints');
});

test('a chat with no record of its own falls back to the account default', () => {
  const storage = storageWith({ [WORK_MODE_DEFAULT_KEY]: 'interrogate' });
  assert.equal(readSessionWorkMode('chat-2', storage), 'interrogate');
});

test('one chat never inherits another chat\'s mode', () => {
  const storage = storageWith({ [workModeStorageKey('chat-1')]: 'interrogate' });
  assert.equal(readSessionWorkMode('chat-2', storage), FALLBACK_WORK_MODE);
});

test('a draft with no session id yet reads the account default', () => {
  const storage = storageWith({ [WORK_MODE_DEFAULT_KEY]: 'checkpoints' });
  assert.equal(readSessionWorkMode(null, storage), 'checkpoints');
});

test('garbage in storage never becomes a mode', () => {
  const storage = storageWith({
    [WORK_MODE_DEFAULT_KEY]: 'plan',
    [workModeStorageKey('chat-3')]: 'AUTOPILOT',
  });
  assert.equal(readDefaultWorkMode(storage), FALLBACK_WORK_MODE);
  assert.equal(readSessionWorkMode('chat-3', storage), FALLBACK_WORK_MODE);
});

test('empty storage and no storage at all both yield the fallback', () => {
  assert.equal(readDefaultWorkMode(storageWith({})), FALLBACK_WORK_MODE);
  assert.equal(readSessionWorkMode('chat-4', undefined), FALLBACK_WORK_MODE);
});
