import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateLocalQueuedMessages, type MigrationStorage } from './migrateLocalQueuedMessages.js';

function memoryStorage(initial: Record<string, string>): MigrationStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => { data.delete(key); },
  };
}

const stored = (content: string, extra: Record<string, unknown> = {}) => JSON.stringify({ content, ...extra });

test('each queued_message_<id> key moves to the server once and is removed', async () => {
  const storage = memoryStorage({
    'queued_message_s1': stored('Привет', { options: { model: 'opus' }, images: [{ path: '/a.png' }] }),
    'queued_message_s2': 'сырой текст старого формата',
    'draft_s1': 'не трогать',
  });
  const calls: Array<[string, unknown]> = [];
  await migrateLocalQueuedMessages({
    storage,
    put: async (sessionId, message) => { calls.push([sessionId, message]); return { ok: true, status: 200 }; },
  });

  assert.deepEqual(calls.sort((a, b) => a[0].localeCompare(b[0])), [
    ['s1', { content: 'Привет', options: { model: 'opus' }, images: [{ path: '/a.png' }] }],
    ['s2', { content: 'сырой текст старого формата' }],
  ]);
  assert.deepEqual([...storage.data.keys()], ['draft_s1']);
});

test('a network error keeps the key for the next start', async () => {
  const storage = memoryStorage({ 'queued_message_s1': stored('Привет') });
  await migrateLocalQueuedMessages({ storage, put: async () => { throw new Error('offline'); } });
  assert.deepEqual([...storage.data.keys()], ['queued_message_s1']);
});

test('a refusal (403/404) removes the key — it will never be accepted — a server error keeps it', async () => {
  const storage = memoryStorage({
    'queued_message_a': stored('a'),
    'queued_message_b': stored('b'),
    'queued_message_c': stored('c'),
  });
  const status: Record<string, number> = { a: 403, b: 404, c: 500 };
  await migrateLocalQueuedMessages({ storage, put: async (id) => ({ ok: false, status: status[id] }) });
  assert.deepEqual([...storage.data.keys()], ['queued_message_c']);
});

test('an empty stored message is just dropped, nothing is sent', async () => {
  const storage = memoryStorage({ 'queued_message_s1': stored('   ') });
  let sent = 0;
  await migrateLocalQueuedMessages({ storage, put: async () => { sent += 1; return { ok: true, status: 200 }; } });
  assert.equal(sent, 0);
  assert.equal(storage.data.size, 0);
});
