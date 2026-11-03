import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { activeChildren, autopilotBlockers, backupDatabase, quietDecision, releaseOnce } from './coordinated-local-release.mjs';

test('activity and edited sources reset the two-minute quiet interval', () => {
  const sample = { blockers: [], sourceHash: 'a' };
  let state = quietDecision({}, sample, 0);
  assert.equal(state.status, 'stabilizing');
  state = quietDecision(state, sample, 119999);
  assert.equal(state.status, 'stabilizing');
  assert.equal(quietDecision(state, sample, 120000).status, 'ready');
  assert.equal(quietDecision(state, { ...sample, sourceHash: 'b' }, 120000).status, 'stabilizing');
  assert.equal(quietDecision(state, { ...sample, blockers: ['working:1'] }, 120000).quietSince, null);
});

test('unfinished review, tickets and questions block release; final publication can wait for it', () => {
  const state = { stages: [{ id: 'build', status: 'done' }, { id: 'review', status: 'active' }, { id: 'final', status: 'pending' }], tickets: [{ id: '1', status: 'done' }] };
  assert.deepEqual(autopilotBlockers(`window.STATE = ${JSON.stringify(state)};`), ['autopilot:review:active']);
  state.stages[1].status = 'done';
  assert.deepEqual(autopilotBlockers(JSON.stringify(state)), []);
  assert.throws(() => autopilotBlockers('unreadable'));
  assert.ok(autopilotBlockers(JSON.stringify({ tickets: [{ id: 2, status: 'active' }], waiting: { kind: 'question' }, tests: { failed: 1 } })).length === 3);
});

test('all unknown runtime children block; plugin host alone does not; process inspection fails closed', () => {
  assert.deepEqual(activeChildren('10 1 node\n20 10 codex\n21 10 grok\n22 10 unknown\n23 10 node /plugins/cloudcli-plugin-starter/server.js\n30 1 unrelated', 10), [20, 21, 22]);
  assert.throws(() => activeChildren('bad row', 10));
});

test('only the exact already-approved release action can bypass the autopilot wait', () => {
  const waiting = { kind: 'action', note: 'ready for common deployment' };
  const approved = createHash('sha256').update(JSON.stringify(waiting)).digest('hex');
  assert.deepEqual(autopilotBlockers(JSON.stringify({ waiting }), approved), []);
  assert.deepEqual(autopilotBlockers(JSON.stringify({ waiting: { ...waiting, note: 'new decision' } }), approved), ['autopilot:waiting-for-decision']);
  assert.deepEqual(autopilotBlockers(JSON.stringify({ waiting }), null), ['autopilot:waiting-for-decision']);
});

test('common release approval covers reviewed final action but never a new question or unfinished work', () => {
  const state = { stages: [{ id: 'review', status: 'done' }, { id: 'final', status: 'active' }], tickets: [{ id: 3, status: 'done' }], waiting: { kind: 'action' } };
  assert.deepEqual(autopilotBlockers(JSON.stringify(state), null, true), []);
  state.waiting.kind = 'question';
  assert.deepEqual(autopilotBlockers(JSON.stringify(state), null, true), ['autopilot:waiting-for-decision']);
  state.waiting.kind = 'action';
  state.tickets[0].status = 'in-progress';
  assert.ok(autopilotBlockers(JSON.stringify(state), null, true).includes('ticket:3:in-progress'));
});

function effects(log, overrides = {}) {
  const names = ['prepare', 'swap', 'restore', 'recordRestart', 'restart', 'verify'];
  return {
    ...Object.fromEntries(names.map(name => [name, async () => { log.push(name); }])),
    inspect: async () => ({ blockers: [], sourceHash: 'a' }),
    inspectActivity: async () => ({ blockers: [], sourceHash: 'a' }),
    ...overrides,
  };
}

test('exactly one restart follows checks, swap and durable attempt marker', async () => {
  const log = [];
  await releaseOnce({}, { sourceHash: 'a' }, effects(log));
  assert.deepEqual(log, ['prepare', 'swap', 'recordRestart', 'restart', 'verify']);
});

test('failed tests, changed sources or activity never cause a restart', async () => {
  for (const override of [
    { prepare: async () => { throw new Error('tests failed'); } },
    { inspect: async () => ({ blockers: [], sourceHash: 'changed' }) },
    { inspect: async () => ({ blockers: ['working'], sourceHash: 'a' }) },
  ]) {
    const log = [];
    await assert.rejects(releaseOnce({}, { sourceHash: 'a' }, effects(log, override)));
    assert.equal(log.includes('swap'), false);
    assert.equal(log.includes('restart'), false);
  }
});

test('new work after swap restores artifacts without restarting', async () => {
  const log = [];
  await assert.rejects(releaseOnce({}, { sourceHash: 'a' }, effects(log, {
    inspectActivity: async () => ({ blockers: ['working'], sourceHash: 'a' }),
  })));
  assert.deepEqual(log, ['prepare', 'swap', 'restore']);
});

test('failed post-restart verification never triggers a second restart', async () => {
  const log = [];
  await assert.rejects(releaseOnce({}, { sourceHash: 'a' }, effects(log, {
    verify: async () => { throw new Error('HTTP failed'); },
  })));
  assert.equal(log.filter(value => value === 'restart').length, 1);
  assert.equal(log.includes('restore'), false);
});

test('resumed work is deferred for a later quiet interval, not treated as release failure', async () => {
  await assert.rejects(releaseOnce({}, { sourceHash: 'a' }, effects([], {
    inspect: async () => ({ blockers: ['working'], sourceHash: 'a' }),
  })), error => error.deferred === true);
  await assert.rejects(releaseOnce({}, { sourceHash: 'a' }, effects([], {
    prepare: async () => { throw new Error('tests failed'); },
  })), error => !error.deferred);
});

test('the database snapshot includes committed WAL data and can be opened independently', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'neo3-release-backup-'));
  const source = path.join(folder, 'source.db'), destination = path.join(folder, 'backup.db');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('preserved');");
    await backupDatabase(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), source, destination);
    const restored = new Database(destination, { readonly: true });
    try { assert.equal(restored.prepare('SELECT value FROM fixture').get().value, 'preserved'); }
    finally { restored.close(); }
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
