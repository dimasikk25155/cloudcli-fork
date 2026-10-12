import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';

/**
 * The link columns must exist after boot both on a brand-new database and on
 * one created before chat links existed (CREATE TABLE IF NOT EXISTS is a
 * no-op there, so only the migration can add them). An existing session must
 * survive the upgrade unlinked.
 */
async function withDatabase(
  seed: ((databasePath: string) => void) | null,
  runTest: (databasePath: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-links-migration-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  closeConnection();
  seed?.(databasePath);
  process.env.DATABASE_PATH = databasePath;
  try {
    await initializeDatabase();
    await runTest(databasePath);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function sessionColumns(databasePath: string): string[] {
  const db = new Database(databasePath, { readonly: true });
  try {
    return (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((column) => column.name);
  } finally {
    db.close();
  }
}

test('a fresh database has the session link columns', async () => {
  await withDatabase(null, (databasePath) => {
    const columns = sessionColumns(databasePath);
    assert.ok(columns.includes('parent_session_id'));
    assert.ok(columns.includes('relation'));
  });
});

test('a database from before chat links gains the columns and keeps its sessions unlinked', async () => {
  const seed = (databasePath: string) => {
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        custom_project_name TEXT DEFAULT NULL,
        isStarred BOOLEAN DEFAULT 0,
        isArchived BOOLEAN DEFAULT 0
      );
      CREATE TABLE sessions (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        provider_session_id TEXT,
        custom_name TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        model TEXT,
        effort TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id)
      );
    `);
    db.prepare("INSERT INTO projects (project_id, project_path) VALUES ('p1', '/workspace/old')").run();
    db.prepare("INSERT INTO sessions (session_id, provider, custom_name, project_path) VALUES ('old-session', 'claude', 'Старый чат', '/workspace/old')").run();
    db.close();
  };

  await withDatabase(seed, (databasePath) => {
    const columns = sessionColumns(databasePath);
    assert.ok(columns.includes('parent_session_id'), 'parent_session_id missing after upgrade');
    assert.ok(columns.includes('relation'), 'relation missing after upgrade');

    const db = new Database(databasePath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT custom_name, parent_session_id, relation FROM sessions WHERE session_id = 'old-session'")
        .get() as { custom_name: string; parent_session_id: string | null; relation: string | null };
      assert.deepEqual(row, { custom_name: 'Старый чат', parent_session_id: null, relation: null });
    } finally {
      db.close();
    }
  });
});

test('booting an already upgraded database again keeps working and keeps the link', async () => {
  await withDatabase(null, async (databasePath) => {
    const db = new Database(databasePath);
    try {
      db.prepare("INSERT INTO projects (project_id, project_path) VALUES ('p2', '/workspace/again')").run();
      db.prepare("INSERT INTO sessions (session_id, provider, project_path) VALUES ('first', 'claude', '/workspace/again')").run();
      db.prepare("INSERT INTO sessions (session_id, provider, project_path, parent_session_id, relation) VALUES ('second', 'claude', '/workspace/again', 'first', 'relay')").run();
    } finally {
      db.close();
    }

    closeConnection();
    await initializeDatabase();

    const reopened = new Database(databasePath, { readonly: true });
    try {
      const row = reopened
        .prepare("SELECT parent_session_id, relation FROM sessions WHERE session_id = 'second'")
        .get() as { parent_session_id: string | null; relation: string | null };
      assert.deepEqual(row, { parent_session_id: 'first', relation: 'relay' });
    } finally {
      reopened.close();
    }
  });
});
