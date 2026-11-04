import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runDurationsDb, sessionsDb } from '@/modules/database/index.js';

/**
 * «Время размышления»: an auth.db from before the column keeps its
 * run_durations shape (CREATE TABLE IF NOT EXISTS is a no-op there), so the
 * column has to arrive by migration and the old rows stay readable.
 * The table below is the shape shipped with «Выполнено за …» (02.11).
 */
const OLD_RUN_DURATIONS_SQL = `
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE run_durations (
    run_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    answer_hash TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);
`;

async function withDatabase(seed: ((db: Database.Database) => void) | null, run: (databasePath: string) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'run-durations-thinking-'));
  const databasePath = path.join(directory, 'auth.db');
  closeConnection();
  if (seed) {
    const db = new Database(databasePath);
    seed(db);
    db.close();
  }
  process.env.DATABASE_PATH = databasePath;
  try {
    await run(databasePath);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('an old run_durations table gains thinking_ms; old rows read as null', async () => {
  await withDatabase((db) => {
    db.exec(OLD_RUN_DURATIONS_SQL);
    db.prepare("INSERT INTO sessions (session_id, provider, project_path) VALUES ('old-s', 'codex', '/workspace/demo')").run();
    db.prepare("INSERT INTO run_durations VALUES ('old-run', 'old-s', 1000, 4000, 3000, 'hash-old')").run();
  }, async (databasePath) => {
    await initializeDatabase();

    const db = new Database(databasePath, { readonly: true });
    try {
      const columns = (db.prepare('PRAGMA table_info(run_durations)').all() as { name: string }[]).map((c) => c.name);
      assert.ok(columns.includes('thinking_ms'), 'run_durations is missing thinking_ms after upgrade');
    } finally {
      db.close();
    }

    const [old] = runDurationsDb.list('old-s');
    assert.equal(old.duration_ms, 3000);
    assert.equal(old.thinking_ms, null);
  });
});

test('thinking time is written and read back; a run without thinking stays null', async () => {
  await withDatabase(null, async () => {
    await initializeDatabase();
    sessionsDb.createAppSession('s-1', 'claude', '/workspace/demo');
    runDurationsDb.save({ run_id: 'r-1', session_id: 's-1', started_at: 10, finished_at: 63_010,
      duration_ms: 63_000, answer_hash: 'h-1', thinking_ms: 12_000 });
    runDurationsDb.save({ run_id: 'r-2', session_id: 's-1', started_at: 70_000, finished_at: 75_000,
      duration_ms: 5_000, answer_hash: 'h-2', thinking_ms: null });

    const rows = runDurationsDb.list('s-1');
    assert.deepEqual(rows.map((row) => [row.run_id, row.duration_ms, row.thinking_ms]),
      [['r-1', 63_000, 12_000], ['r-2', 5_000, null]]);
  });
});
