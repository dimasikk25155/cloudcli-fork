import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
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

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('createSession reactivates archived rows when the session becomes active again', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const restoredSession = sessionsDb.getSessionById('session-reused');

    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.session_id, 'session-reused');
    assert.equal(activeSessions[0]?.custom_name, 'Updated Name');
    assert.equal(archivedSessions.length, 0);
    assert.equal(restoredSession?.isArchived, 0);
  });
});

test('createSession leaves an archived row archived when the transcript has not changed', async () => {
  await withIsolatedDatabase(() => {
    const createdAt = '2026-07-18T09:00:00.000Z';
    const updatedAt = '2026-07-18T10:00:00.000Z';
    const jsonlPath = '/transcripts/session-untouched.jsonl';

    sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, updatedAt, jsonlPath);
    sessionsDb.updateSessionIsArchived('session-untouched', true);

    sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, updatedAt, jsonlPath);

    assert.equal(sessionsDb.getSessionById('session-untouched')?.isArchived, 1);
    assert.equal(sessionsDb.getArchivedSessions().length, 1);
    assert.equal(sessionsDb.getAllSessions().length, 0);

    sessionsDb.createSession('session-untouched', 'claude', '/workspace/demo-project', 'A Name', createdAt, '2026-07-18T11:00:00.000Z', jsonlPath);

    assert.equal(sessionsDb.getSessionById('session-untouched')?.isArchived, 0);
  });
});

test('the upsert path counts an omitted timestamp as activity', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-legacy', 'claude', '/workspace/demo-project');
    sessionsDb.updateSessionIsArchived('session-legacy', true);

    sessionsDb.createSession('session-legacy', 'claude', '/workspace/demo-project', 'Indexed Name');

    assert.equal(sessionsDb.getSessionById('session-legacy')?.isArchived, 0);
  });
});

test('the upsert path leaves an archived row alone for a transcript older than it', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-stale', 'claude', '/workspace/demo-project');
    sessionsDb.updateSessionIsArchived('session-stale', true);

    sessionsDb.createSession(
      'session-stale',
      'claude',
      '/workspace/demo-project',
      'Indexed Name',
      '2026-07-18T09:00:00.000Z',
      '2026-07-18T10:00:00.000Z',
      '/transcripts/session-stale.jsonl',
    );

    assert.equal(sessionsDb.getSessionById('session-stale')?.isArchived, 1);
  });
});

test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});
