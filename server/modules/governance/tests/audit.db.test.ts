import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditDb, closeConnection, getConnection, initializeDatabase, userDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'audit-db-'));

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

function append(overrides: Partial<Parameters<typeof auditDb.appendEvent>[0]> = {}) {
  return auditDb.appendEvent({
    ts: '2026-08-23T20:00:00.000Z',
    dayMsk: '2026-08-23',
    actor: 'user',
    event: 'run.start',
    ...overrides,
  });
}

test('appendEvent stores a row and returns it', async () => {
  await withIsolatedDatabase(() => {
    const userId = createUser('owner');
    const row = append({ userId, runId: 'run-1', projectPath: '/tmp/project' });

    assert.ok(row);
    assert.equal(row?.actor, 'user');
    assert.equal(row?.run_id, 'run-1');
    assert.equal(row?.cost_micro_usd, 0);
  });
});

// The whole point of the table: history that cannot be rewritten. If these two
// ever start passing silently, the audit log has become an ordinary table.
test('audit rows cannot be updated', async () => {
  await withIsolatedDatabase(() => {
    append({ runId: 'run-1' });
    const db = getConnection();

    assert.throws(
      () => db.prepare(`UPDATE audit_log SET detail = 'edited' WHERE run_id = 'run-1'`).run(),
      /append-only/
    );
  });
});

test('audit rows cannot be deleted', async () => {
  await withIsolatedDatabase(() => {
    append({ runId: 'run-1' });
    const db = getConnection();

    assert.throws(() => db.prepare(`DELETE FROM audit_log WHERE run_id = 'run-1'`).run(), /append-only/);
  });
});

// Metering must be safe to retry. A reconnect or a transient-failure retry that
// re-reports the same run has to be ignored, or the spend panel double-bills.
test('a repeated run.finish for the same run is ignored', async () => {
  await withIsolatedDatabase(() => {
    const first = append({ event: 'run.finish', runId: 'run-1', costMicroUsd: 12_000 });
    const second = append({ event: 'run.finish', runId: 'run-1', costMicroUsd: 12_000 });

    assert.ok(first, 'first finish should be stored');
    assert.equal(second, null, 'second finish should be refused as a duplicate');

    const totals = auditDb.sumSpend(['2026-08-23']);
    assert.equal(totals.costMicroUsd, 12_000);
    assert.equal(totals.runs, 1);
  });
});

test('run.start is not deduplicated — only run.finish carries the guard', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(append({ event: 'run.start', runId: 'run-1' }));
    assert.ok(append({ event: 'run.start', runId: 'run-1' }));
  });
});

test('sumSpend only counts run.finish rows', async () => {
  await withIsolatedDatabase(() => {
    append({ event: 'run.start', runId: 'run-1', costMicroUsd: 999_999 });
    append({ event: 'run.finish', runId: 'run-1', costMicroUsd: 5_000, tokensIn: 100, tokensOut: 20 });

    const totals = auditDb.sumSpend(['2026-08-23']);
    assert.equal(totals.costMicroUsd, 5_000);
    assert.equal(totals.tokensIn, 100);
    assert.equal(totals.tokensOut, 20);
    assert.equal(totals.runs, 1);
  });
});

test('sumSpend scopes by user', async () => {
  await withIsolatedDatabase(() => {
    const mine = createUser('mine');
    const theirs = createUser('theirs');

    append({ event: 'run.finish', runId: 'run-mine', userId: mine, costMicroUsd: 1_000 });
    append({ event: 'run.finish', runId: 'run-theirs', userId: theirs, costMicroUsd: 9_000 });

    assert.equal(auditDb.sumSpend(['2026-08-23'], { userId: mine }).costMicroUsd, 1_000);
  });
});

test('sumSpend over an empty day list returns zeroes rather than everything', async () => {
  await withIsolatedDatabase(() => {
    append({ event: 'run.finish', runId: 'run-1', costMicroUsd: 7_000 });

    const totals = auditDb.sumSpend([]);
    assert.equal(totals.costMicroUsd, 0);
    assert.equal(totals.runs, 0);
  });
});

test('getRunTimeline returns one run in chronological order', async () => {
  await withIsolatedDatabase(() => {
    append({ event: 'run.start', runId: 'run-1' });
    append({ event: 'run.finish', runId: 'run-1' });
    append({ event: 'run.start', runId: 'run-2' });

    const timeline = auditDb.getRunTimeline('run-1');
    assert.deepEqual(
      timeline.map((row) => row.event),
      ['run.start', 'run.finish']
    );
  });
});

test('listEvents filters and paginates newest first', async () => {
  await withIsolatedDatabase(() => {
    append({ event: 'run.start', runId: 'run-1', actor: 'user' });
    append({ event: 'run.start', runId: 'run-2', actor: 'schedule' });
    append({ event: 'run.start', runId: 'run-3', actor: 'schedule' });

    const scheduled = auditDb.listEvents({ actor: 'schedule' });
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].run_id, 'run-3', 'newest first');

    const page = auditDb.listEvents({ beforeId: scheduled[0].id });
    assert.ok(page.every((row) => row.id < scheduled[0].id));
  });
});

test('topRuns orders by cost', async () => {
  await withIsolatedDatabase(() => {
    append({ event: 'run.finish', runId: 'cheap', costMicroUsd: 100 });
    append({ event: 'run.finish', runId: 'expensive', costMicroUsd: 900_000 });

    const top = auditDb.topRuns(['2026-08-23']);
    assert.equal(top[0].run_id, 'expensive');
  });
});
