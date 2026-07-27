import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';

/**
 * Guards the upgrade path, which a fresh-install test cannot reach: an existing
 * database keeps its original table shape, because CREATE TABLE IF NOT EXISTS is a
 * no-op once the table is there. The server used to crash at boot on an install
 * predating `users.is_active` — INIT_SCHEMA_SQL created an index over a column that
 * only newer databases had, and migrations never got a chance to run.
 *
 * The shape below is the oldest users table this fork ever shipped.
 */
const LEGACY_USERS_TABLE_SQL = `
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
);
`;

async function withLegacyDatabase(
  runTest: (databasePath: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'legacy-upgrade-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();

  const seed = new Database(databasePath);
  seed.exec(LEGACY_USERS_TABLE_SQL);
  seed
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run('owner', 'hash-owner');
  seed
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run('teammate', 'hash-teammate');
  seed.close();

  process.env.DATABASE_PATH = databasePath;

  try {
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

test('a database from before is_active/role still boots and gains both', async () => {
  await withLegacyDatabase(async (databasePath) => {
    // The bug was a throw right here, so reaching the assertions is half the test.
    await initializeDatabase();

    const db = new Database(databasePath, { readonly: true });
    try {
      const columns = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[])
        .map((column) => column.name);

      for (const expected of ['is_active', 'role', 'git_name', 'git_email', 'has_completed_onboarding']) {
        assert.ok(columns.includes(expected), `users is missing ${expected} after upgrade`);
      }

      const accessTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_project_access'")
        .get();
      assert.ok(accessTable, 'user_project_access was not created on upgrade');

      const activeIndex = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_active'")
        .get();
      assert.ok(activeIndex, 'idx_users_active was not created after the column was added');

      // The existing account has to come out an admin, otherwise the owner is locked
      // out of their own team settings after an update.
      const roles = db.prepare('SELECT username, role FROM users ORDER BY id').all() as {
        username: string;
        role: string;
      }[];
      assert.deepEqual(roles, [
        { username: 'owner', role: 'admin' },
        { username: 'teammate', role: 'user' },
      ]);
    } finally {
      db.close();
    }
  });
});
