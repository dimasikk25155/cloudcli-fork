import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';
import { schedulesDb } from '@/modules/database/repositories/schedules.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'schedules-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

function createUser(username: string): number {
  return Number(userDb.createUser(username, 'hash').id);
}

test('schedulesDb.create applies defaults and returns the stored row', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const row = schedulesDb.create({ userId, name: 'Morning report', hour: 9, minute: 30 });

    assert.equal(row.user_id, userId);
    assert.equal(row.kind, 'prompt');
    assert.equal(row.weekdays, '');
    assert.equal(row.enabled, 1);
    assert.equal(row.prompt, '');
    assert.equal(row.os_label, null);
    assert.equal(row.last_run_at, null);
  });
});

test('schedulesDb.listByUser never leaks another user rows', async () => {
  await withIsolatedDatabase(() => {
    const owner = createUser('owner');
    const stranger = createUser('stranger');

    schedulesDb.create({ userId: owner, name: 'Owner 10:00', hour: 10, minute: 0 });
    schedulesDb.create({ userId: owner, name: 'Owner 08:00', hour: 8, minute: 0 });
    schedulesDb.create({ userId: stranger, name: 'Stranger', hour: 7, minute: 0 });

    const ownerRows = schedulesDb.listByUser(owner);
    assert.deepEqual(
      ownerRows.map((row) => row.name),
      ['Owner 08:00', 'Owner 10:00']
    );
    assert.deepEqual(
      schedulesDb.listByUser(stranger).map((row) => row.name),
      ['Stranger']
    );
  });
});

test('schedulesDb.update writes only the provided fields', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const created = schedulesDb.create({
      userId,
      name: 'Report',
      projectPath: '/workspace/app',
      prompt: 'Summarise yesterday',
      hour: 9,
      minute: 30,
      weekdays: '1,3,5',
    });

    const updated = schedulesDb.update(created.id, { hour: 21, weekdays: '' });

    assert.ok(updated);
    assert.equal(updated?.hour, 21);
    assert.equal(updated?.minute, 30);
    assert.equal(updated?.weekdays, '');
    assert.equal(updated?.prompt, 'Summarise yesterday');
    assert.equal(updated?.project_path, '/workspace/app');
  });
});

test('schedulesDb.update with an empty patch is a no-op read', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const created = schedulesDb.create({ userId, name: 'Report', hour: 9, minute: 30 });

    const updated = schedulesDb.update(created.id, {});
    assert.deepEqual(updated, created);
  });
});

test('schedulesDb tracks enabled, os_label and the last run', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const created = schedulesDb.create({ userId, name: 'Report', hour: 9, minute: 30 });

    assert.equal(schedulesDb.setEnabled(created.id, false)?.enabled, 0);
    assert.equal(schedulesDb.setEnabled(created.id, true)?.enabled, 1);

    schedulesDb.setOsLabel(created.id, 'ru.tarariev.neo3-schedule-1');
    schedulesDb.markRun(created.id, 'ok');

    const row = schedulesDb.getById(created.id);
    assert.equal(row?.os_label, 'ru.tarariev.neo3-schedule-1');
    assert.equal(row?.last_status, 'ok');
    assert.ok(row?.last_run_at, 'last_run_at must be stamped');
  });
});

test('schedulesDb.markRun truncates a runaway error message', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const created = schedulesDb.create({ userId, name: 'Report', hour: 9, minute: 30 });

    schedulesDb.markRun(created.id, `error: ${'x'.repeat(5000)}`);

    assert.equal(schedulesDb.getById(created.id)?.last_status?.length, 500);
  });
});

test('schedulesDb.remove deletes the row and reports whether it existed', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const created = schedulesDb.create({ userId, name: 'Report', hour: 9, minute: 30 });

    assert.equal(schedulesDb.remove(created.id), true);
    assert.equal(schedulesDb.remove(created.id), false);
    assert.equal(schedulesDb.getById(created.id), null);
  });
});
