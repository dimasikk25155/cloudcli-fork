import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import { KimiSessionSynchronizer } from '@/modules/providers/list/kimi/kimi-session-synchronizer.provider.js';

const WORK_DIR = '/workspace/demo';

// Writes a Kimi session on disk the way the CLI does and returns the wire path.
async function writeKimiSession(home: string, sessionId: string): Promise<string> {
  const sessionDir = path.join(home, 'sessions', 'wd-demo', sessionId);
  const agentDir = path.join(sessionDir, 'agents', 'main');
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, 'state.json'),
    JSON.stringify({ title: 'Disk Title', workDir: WORK_DIR, createdAt: '2026-07-23T00:00:00Z' }),
  );
  const wirePath = path.join(agentDir, 'wire.jsonl');
  await writeFile(wirePath, '{"type":"context.append_message"}\n');
  return wirePath;
}

async function withIsolatedEnv(
  runTest: (home: string, sync: KimiSessionSynchronizer) => Promise<void>,
): Promise<void> {
  const previousDbPath = process.env.DATABASE_PATH;
  const previousKimiHome = process.env.KIMI_CODE_HOME;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'kimi-sync-'));
  const home = path.join(tempDir, 'kimi-home');
  await mkdir(home, { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  process.env.KIMI_CODE_HOME = home;
  await initializeDatabase();

  try {
    await runTest(home, new KimiSessionSynchronizer());
  } finally {
    closeConnection();
    if (previousDbPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDbPath;
    if (previousKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = previousKimiHome;
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('external `kimi -p` sessions are not indexed into the sidebar', async () => {
  await withIsolatedEnv(async (home, sync) => {
    // No app row exists — this is a bare terminal run.
    const wirePath = await writeKimiSession(home, 'session_external');

    const result = await sync.synchronizeFile(wirePath);

    assert.equal(result, null);
    assert.equal(sessionsDb.getAllSessions().length, 0);
  });
});

test('app-started Kimi sessions claim the pending app row and get indexed', async () => {
  await withIsolatedEnv(async (home, sync) => {
    // The app allocated a row when the user sent the message; Kimi has not yet
    // reported its provider id (it only does so at the end of the run).
    sessionsDb.createAppSession('app-kimi-1', 'kimi', WORK_DIR);
    const wirePath = await writeKimiSession(home, 'session_owned');

    const result = await sync.synchronizeFile(wirePath);

    // The pending app row is claimed, not duplicated.
    assert.equal(result, 'app-kimi-1');
    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-kimi-1');
    assert.equal(rows[0]?.provider_session_id, 'session_owned');
  });
});
