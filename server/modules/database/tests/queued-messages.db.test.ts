import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getConnection, initializeDatabase, queuedMessagesDb } from '@/modules/database/index.js';

async function withDatabase(prepare: ((file: string) => void) | null, run: () => Promise<void> | void) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'queued-messages-db-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  try {
    closeConnection();
    const file = path.join(tempDirectory, 'auth.db');
    prepare?.(file);
    process.env.DATABASE_PATH = file;
    await initializeDatabase();
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const columnsOf = () => (getConnection().prepare('PRAGMA table_info(session_queued_messages)').all() as Array<{ name: string }>)
  .map((column) => column.name)
  .sort();

const T1 = '2026-11-23T16:00:00.000Z';
const T2 = '2026-11-23T16:05:00.000Z';
const T3 = '2026-11-23T16:09:00.000Z';

test('session_queued_messages: one cell per chat — put, read, replace, hold, remove', async () => {
  await withDatabase(null, () => {
    assert.deepEqual(columnsOf(), [
      'content', 'created_at', 'hold_reason', 'images_json', 'last_error', 'options_json', 'send_now', 'session_id', 'updated_at', 'user_id',
    ]);
    assert.equal(queuedMessagesDb.get('chat-1'), null);

    const first = queuedMessagesDb.put({
      sessionId: 'chat-1', userId: 7, content: 'Сначала проверь тесты', optionsJson: '{"model":"opus[1m]"}', imagesJson: '[{"path":"a.png"}]', at: T1,
    });
    assert.deepEqual(first, {
      sessionId: 'chat-1', userId: 7, content: 'Сначала проверь тесты', optionsJson: '{"model":"opus[1m]"}', imagesJson: '[{"path":"a.png"}]',
      holdReason: null, lastError: null, sendNow: false, createdAt: T1, updatedAt: T1,
    });
    assert.deepEqual(queuedMessagesDb.get('chat-1'), first);

    // A held message with an error and the «send now» mark…
    assert.equal(queuedMessagesDb.setHold('chat-1', { holdReason: 'error', lastError: 'Нет доступа к проекту', at: T2 }), true);
    assert.equal(queuedMessagesDb.setSendNow('chat-1', true), true);
    assert.deepEqual(
      [queuedMessagesDb.get('chat-1')?.holdReason, queuedMessagesDb.get('chat-1')?.lastError, queuedMessagesDb.get('chat-1')?.sendNow, queuedMessagesDb.get('chat-1')?.updatedAt],
      ['error', 'Нет доступа к проекту', true, T2],
    );

    // …replaced by an edit from another user: the same cell, clean again, first queued time kept.
    const edited = queuedMessagesDb.put({ sessionId: 'chat-1', userId: 9, content: 'Нет, сначала выкати', optionsJson: null, imagesJson: null, at: T3 });
    assert.deepEqual(edited, {
      sessionId: 'chat-1', userId: 9, content: 'Нет, сначала выкати', optionsJson: null, imagesJson: null,
      holdReason: null, lastError: null, sendNow: false, createdAt: T1, updatedAt: T3,
    });
    assert.equal((getConnection().prepare('SELECT COUNT(*) AS n FROM session_queued_messages').get() as { n: number }).n, 1);

    // Another chat has its own cell.
    queuedMessagesDb.put({ sessionId: 'chat-2', userId: 7, content: 'x', optionsJson: null, imagesJson: null, at: T1 });
    assert.deepEqual(queuedMessagesDb.list().map((row) => row.sessionId).sort(), ['chat-1', 'chat-2']);

    assert.equal(queuedMessagesDb.setHold('missing', { holdReason: 'stopped', lastError: null, at: T2 }), false);
    assert.equal(queuedMessagesDb.remove('chat-1'), true);
    assert.equal(queuedMessagesDb.remove('chat-1'), false);
    assert.equal(queuedMessagesDb.get('chat-1'), null);
    assert.equal(queuedMessagesDb.get('chat-2')?.content, 'x');
  });
});

test('remove with a stamp only takes the version that was sent: an edit made meanwhile stays queued', async () => {
  await withDatabase(null, () => {
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: 7, content: 'первая версия', optionsJson: null, imagesJson: null, at: T1 });
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: 7, content: 'вторая версия', optionsJson: null, imagesJson: null, at: T2 });
    assert.equal(queuedMessagesDb.remove('chat-1', T1), false);
    assert.equal(queuedMessagesDb.get('chat-1')?.content, 'вторая версия');
    assert.equal(queuedMessagesDb.remove('chat-1', T2), true);
    assert.equal(queuedMessagesDb.get('chat-1'), null);
  });
});

test('holdAll marks every queued message (server restart) and drops «send now» marks', async () => {
  await withDatabase(null, () => {
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: 7, content: 'a', optionsJson: null, imagesJson: null, at: T1 });
    queuedMessagesDb.put({ sessionId: 'chat-2', userId: 7, content: 'b', optionsJson: null, imagesJson: null, at: T1 });
    queuedMessagesDb.setSendNow('chat-2', true);
    queuedMessagesDb.setHold('chat-1', { holdReason: 'error', lastError: 'Движок недоступен', at: T1 });

    assert.equal(queuedMessagesDb.holdAll('restart', T2), 2);
    for (const id of ['chat-1', 'chat-2']) {
      const row = queuedMessagesDb.get(id);
      assert.deepEqual([row?.holdReason, row?.lastError, row?.sendNow, row?.updatedAt], ['restart', null, false, T2]);
    }
  });
});

test('an older database gains the table on upgrade and keeps its other data', async () => {
  await withDatabase((file) => {
    const db = new Database(file);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
      INSERT INTO users (username, password_hash) VALUES ('dima', 'x');
    `);
    db.close();
  }, () => {
    assert.ok(columnsOf().includes('hold_reason'));
    assert.equal((getConnection().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: 1, content: 'после обновления', optionsJson: null, imagesJson: null, at: T1 });
    assert.equal(queuedMessagesDb.get('chat-1')?.content, 'после обновления');
  });
});
