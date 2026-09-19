import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Через barrel модуля, а не в его внутренности: у соседнего kimi-теста тут
// три ошибки boundaries/dependencies, и повторять их незачем.
import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { GrokSessionSynchronizer } from '@/modules/providers/list/grok/grok-session-synchronizer.provider.js';

const WORK_DIR = '/workspace/demo';

/**
 * Writes a Grok session on disk exactly the way the CLI does: the folder above
 * the session is the percent-encoded cwd, and summary.json carries the decoded
 * one — which is why the indexer never has to reverse the encoding.
 */
async function writeGrokSession(
  home: string,
  sessionId: string,
  summary: Record<string, unknown> = {},
  userText = 'hi',
): Promise<string> {
  const sessionDir = path.join(home, 'sessions', encodeURIComponent(WORK_DIR), sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, 'summary.json'),
    JSON.stringify({
      info: { id: sessionId, cwd: WORK_DIR },
      session_summary: 'Disk Title',
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T01:00:00Z',
      current_model_id: 'grok-4.6',
      ...summary,
    }),
  );
  const historyPath = path.join(sessionDir, 'chat_history.jsonl');
  await writeFile(historyPath, `${JSON.stringify({ type: 'user', content: userText })}\n`);
  return historyPath;
}

async function withIsolatedEnv(
  runTest: (home: string, sync: GrokSessionSynchronizer) => Promise<void>,
): Promise<void> {
  const previousDbPath = process.env.DATABASE_PATH;
  const previousGrokHome = process.env.GROK_HOME;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'grok-sync-'));
  const home = path.join(tempDir, 'grok-home');
  await mkdir(home, { recursive: true });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  process.env.GROK_HOME = home;
  await initializeDatabase();

  try {
    await runTest(home, new GrokSessionSynchronizer());
  } finally {
    closeConnection();
    if (previousDbPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDbPath;
    if (previousGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousGrokHome;
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('external `grok -p` sessions are not indexed into the sidebar', async () => {
  await withIsolatedEnv(async (home, sync) => {
    // A bare terminal run writes the same shape but has no app row behind it.
    const historyPath = await writeGrokSession(home, 'a1111111-2222-3333-4444-555555555555');

    assert.equal(await sync.synchronizeFile(historyPath), null);
    assert.equal(sessionsDb.getAllSessions().length, 0);
  });
});

test('app-started Grok sessions claim the pending app row and get indexed', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-1', 'grok', WORK_DIR);
    const historyPath = await writeGrokSession(home, 'b1111111-2222-3333-4444-555555555555');

    assert.equal(await sync.synchronizeFile(historyPath), 'app-grok-1');

    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-grok-1');
    assert.equal(rows[0]?.provider_session_id, 'b1111111-2222-3333-4444-555555555555');
    // Путь берётся из summary.json, а не из имени папки, — иначе в сайдбаре
    // оказался бы %2Fworkspace%2Fdemo.
    assert.equal(rows[0]?.project_path, WORK_DIR);
    // First user turn wins over Grok CLI's English auto-title.
    assert.equal(rows[0]?.custom_name, 'Hi');
  });
});

test('a Russian first prompt becomes a short Russian sidebar name', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-ru', 'grok', WORK_DIR);
    const historyPath = await writeGrokSession(
      home,
      'b2111111-2222-3333-4444-555555555555',
      { session_summary: 'One-Word Russian Hello Greeting Request' },
      'короче, сделай названия сессий на русском',
    );

    assert.equal(await sync.synchronizeFile(historyPath), 'app-grok-ru');
    assert.equal(sessionsDb.getAllSessions()[0]?.custom_name, 'Короче, сделай названия сессий на русском');
  });
});

test('only chat_history.jsonl is indexed, not the neighbouring streams', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-2', 'grok', WORK_DIR);
    const historyPath = await writeGrokSession(home, 'c1111111-2222-3333-4444-555555555555');
    const updatesPath = path.join(path.dirname(historyPath), 'updates.jsonl');
    await writeFile(updatesPath, '{"type":"session_update"}\n');

    assert.equal(await sync.synchronizeFile(updatesPath), null);
    // Ожидающая строка приложения остаётся непривязанной: индексируется
    // только история чата, соседние потоки Grok не считаются сессией.
    assert.equal(sessionsDb.getAllSessions()[0]?.provider_session_id, null);
  });
});

test('a session still initializing (no summary yet) is skipped, not half-indexed', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-3', 'grok', WORK_DIR);
    const sessionDir = path.join(home, 'sessions', encodeURIComponent(WORK_DIR), 'd1111111-2222-3333-4444-555555555555');
    await mkdir(sessionDir, { recursive: true });
    const historyPath = path.join(sessionDir, 'chat_history.jsonl');
    await writeFile(historyPath, '');

    assert.equal(await sync.synchronizeFile(historyPath), null);
    assert.equal(sessionsDb.getAllSessions()[0]?.provider_session_id, null);
  });
});

test('a name given in the app survives the CLI auto-title', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-4', 'grok', WORK_DIR);
    const historyPath = await writeGrokSession(home, 'e1111111-2222-3333-4444-555555555555');
    await sync.synchronizeFile(historyPath);

    sessionsDb.updateSessionCustomName('app-grok-4', 'Как Дима назвал');
    await sync.synchronizeFile(historyPath);

    assert.equal(sessionsDb.getAllSessions()[0]?.custom_name, 'Как Дима назвал');
  });
});

test('the full scan walks the sessions root and counts what it indexed', async () => {
  await withIsolatedEnv(async (home, sync) => {
    sessionsDb.createAppSession('app-grok-5', 'grok', WORK_DIR);
    await writeGrokSession(home, 'f1111111-2222-3333-4444-555555555555');

    assert.equal(await sync.synchronize(), 1);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});
