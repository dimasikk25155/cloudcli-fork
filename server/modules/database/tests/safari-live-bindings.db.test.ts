import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, safariLiveBindingsDb } from '@/modules/database/index.js';

test('safari_live_bindings: migration creates the table; get/set/clear keep one window per chat', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'safari-live-bindings-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  t.after(async () => {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const columns = (getConnection().prepare('PRAGMA table_info(safari_live_bindings)').all() as Array<{ name: string }>)
    .map((column) => column.name)
    .sort();
  assert.deepEqual(columns, ['bound_by', 'session_id', 'title', 'updated_at', 'window_id']);

  assert.equal(safariLiveBindingsDb.get('chat-1'), null);

  const first = safariLiveBindingsDb.set('chat-1', { windowId: 4242, title: 'Пример — Safari', boundBy: 'agent' });
  assert.equal(first.sessionId, 'chat-1');
  assert.equal(first.windowId, 4242);
  assert.equal(first.title, 'Пример — Safari');
  assert.equal(first.boundBy, 'agent');
  assert.ok(!Number.isNaN(Date.parse(first.updatedAt)), 'updatedAt is an ISO date');
  assert.deepEqual(safariLiveBindingsDb.get('chat-1'), first);

  // The user picks another window: the same chat now points at it.
  const second = safariLiveBindingsDb.set('chat-1', { windowId: 77, title: 'Другое окно', boundBy: 'user' });
  assert.equal(safariLiveBindingsDb.get('chat-1')?.windowId, 77);
  assert.equal(safariLiveBindingsDb.get('chat-1')?.boundBy, 'user');
  assert.equal(second.title, 'Другое окно');

  // Another chat is independent.
  safariLiveBindingsDb.set('chat-2', { windowId: 5, title: '', boundBy: 'agent' });
  safariLiveBindingsDb.clear('chat-1');
  assert.equal(safariLiveBindingsDb.get('chat-1'), null);
  assert.equal(safariLiveBindingsDb.get('chat-2')?.windowId, 5);

  // Running the migrations again on an existing database keeps the rows.
  closeConnection();
  await initializeDatabase();
  assert.equal(safariLiveBindingsDb.get('chat-2')?.windowId, 5);
});
