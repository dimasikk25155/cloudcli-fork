import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getConnection, initializeDatabase, safariLiveBindingsDb } from '@/modules/database/index.js';

async function withDatabase(prepare: ((file: string) => void) | null, run: () => Promise<void> | void) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'safari-live-bindings-'));
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

const columnsOf = () => (getConnection().prepare('PRAGMA table_info(safari_live_bindings)').all() as Array<{ name: string }>)
  .map((column) => column.name)
  .sort();

test('safari_live_bindings: one page per chat with its last address; get/set/clear; the page follows navigation', async () => {
  await withDatabase(null, async () => {
    assert.deepEqual(columnsOf(), ['bound_by', 'page_id', 'session_id', 'title', 'updated_at', 'url', 'window_id']);
    assert.equal(safariLiveBindingsDb.get('chat-1'), null);

    const first = safariLiveBindingsDb.set('chat-1', { pageId: 'chat-chat-1', url: 'https://example.com/', title: 'Пример', boundBy: 'agent' });
    assert.equal(first.sessionId, 'chat-1');
    assert.equal(first.pageId, 'chat-chat-1');
    assert.equal(first.url, 'https://example.com/');
    assert.equal(first.title, 'Пример');
    assert.equal(first.boundBy, 'agent');
    assert.ok(!Number.isNaN(Date.parse(first.updatedAt)), 'updatedAt is an ISO date');
    assert.deepEqual(safariLiveBindingsDb.get('chat-1'), first);

    // The user picks another chat's page: the same chat now points at it.
    safariLiveBindingsDb.set('chat-1', { pageId: 'chat-chat-2', url: 'https://example.org/', title: 'Другая', boundBy: 'user' });
    assert.equal(safariLiveBindingsDb.get('chat-1')?.pageId, 'chat-chat-2');
    assert.equal(safariLiveBindingsDb.get('chat-1')?.boundBy, 'user');

    // The page went elsewhere: every chat bound to it keeps the new last address.
    safariLiveBindingsDb.set('chat-2', { pageId: 'chat-chat-2', url: 'https://example.org/', title: 'Другая', boundBy: 'agent' });
    safariLiveBindingsDb.updatePage('chat-chat-2', { url: 'https://example.org/next', title: 'Дальше' });
    assert.equal(safariLiveBindingsDb.get('chat-1')?.url, 'https://example.org/next');
    assert.equal(safariLiveBindingsDb.get('chat-2')?.title, 'Дальше');

    safariLiveBindingsDb.clear('chat-1');
    assert.equal(safariLiveBindingsDb.get('chat-1'), null);
    assert.equal(safariLiveBindingsDb.get('chat-2')?.pageId, 'chat-chat-2');

    // Running the migrations again on an existing database keeps the rows.
    closeConnection();
    await initializeDatabase();
    assert.equal(safariLiveBindingsDb.get('chat-2')?.url, 'https://example.org/next');
  });
});

test('safari_live_bindings migration: an older table (Safari windows) gains page_id and url; its old rows are ignored', async () => {
  await withDatabase((file) => {
    const old = new Database(file);
    old.exec(`CREATE TABLE safari_live_bindings (
      session_id TEXT PRIMARY KEY, window_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
      bound_by TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.prepare('INSERT INTO safari_live_bindings VALUES (?, ?, ?, ?, ?)').run('old-chat', 4242, 'Safari', 'agent', '2026-11-05T01:00:00Z');
    old.close();
  }, () => {
    assert.deepEqual(columnsOf(), ['bound_by', 'page_id', 'session_id', 'title', 'updated_at', 'url', 'window_id']);
    assert.equal(safariLiveBindingsDb.get('old-chat'), null, 'a Safari window binding is not a page');
    const bound = safariLiveBindingsDb.set('old-chat', { pageId: 'chat-old-chat', url: 'https://example.com/', title: 'Пример', boundBy: 'agent' });
    assert.deepEqual(safariLiveBindingsDb.get('old-chat'), bound);
  });
});

test('safari_live_bindings: a page the agent closed is marked in every chat bound to it (empty address, title kept) and stays so after a restart', async () => {
  await withDatabase(null, async () => {
    safariLiveBindingsDb.set('chat-1', { pageId: 'chat-chat-1', url: 'https://example.com/', title: 'Пример', boundBy: 'agent' });
    safariLiveBindingsDb.set('chat-2', { pageId: 'chat-chat-1', url: 'https://example.com/', title: 'Пример', boundBy: 'user' });
    safariLiveBindingsDb.set('chat-3', { pageId: 'chat-chat-3', url: 'https://example.org/', title: 'Другая', boundBy: 'agent' });

    safariLiveBindingsDb.markClosed('chat-chat-1');
    assert.equal(safariLiveBindingsDb.get('chat-1')?.url, '');
    assert.equal(safariLiveBindingsDb.get('chat-1')?.title, 'Пример');
    assert.equal(safariLiveBindingsDb.get('chat-1')?.pageId, 'chat-chat-1');
    assert.equal(safariLiveBindingsDb.get('chat-2')?.url, '');
    assert.equal(safariLiveBindingsDb.get('chat-3')?.url, 'https://example.org/', 'another page is untouched');

    closeConnection();
    await initializeDatabase();
    assert.equal(safariLiveBindingsDb.get('chat-1')?.url, '', 'closed survives a restart');

    // Opened again by the agent → a normal binding with an address.
    safariLiveBindingsDb.set('chat-1', { pageId: 'chat-chat-1', url: 'https://example.com/again', title: 'Снова', boundBy: 'agent' });
    assert.equal(safariLiveBindingsDb.get('chat-1')?.url, 'https://example.com/again');
  });
});
