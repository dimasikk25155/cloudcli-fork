import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sidebarGroupsDb, userDb } from '@/modules/database/index.js';
import { createIsModOn } from '@/shared/mods.js';

import { createSidebarGroupsService } from '../sidebar-groups.service.js';

async function fixture(t: test.TestContext, options: { modOff?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sidebar-groups-'));
  const previous = process.env.DATABASE_PATH;
  t.after(async () => {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  });
  closeConnection();
  process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  const alice = Number(userDb.createUser('alice', 'hash').id);
  const bob = Number(userDb.createUser('bob', 'hash').id);
  const notified: number[] = [];
  let ids = 0;
  const service = createSidebarGroupsService({
    repo: sidebarGroupsDb,
    // alice sees p1, p2 and chats s1, s2; bob sees only p3.
    canAccessProject: (userId, projectId) => (userId === alice ? ['p1', 'p2'] : ['p3']).includes(projectId),
    canAccessSession: (userId, sessionId) => userId === alice && ['s1', 's2'].includes(sessionId),
    notify: (userId) => notified.push(userId),
    isModOn: createIsModOn(() => (options.modOff ? { modGroups: false } : {})),
    now: () => '2026-11-04T10:00:00.000Z',
    newId: () => `g${++ids}`,
  });
  return { service, alice, bob, notified };
}

test('groups are created on a database that predates them, per user, and survive a re-read', async (t) => {
  const { service, alice, bob, notified } = await fixture(t);
  // An existing auth.db has no such tables until the migration runs.
  getConnection().exec('DROP TABLE sidebar_group_items; DROP TABLE sidebar_groups; DROP TABLE session_pins;');
  closeConnection();
  await initializeDatabase(); // the existing file is migrated on start

  service.create(alice, { name: '  Клиенты ' });
  service.create(alice, { name: 'Личное' });
  const tree = service.addItem(alice, 'g1', 'project', 'p1');
  assert.deepEqual(tree.groups.map((group) => group.name), ['Клиенты', 'Личное']);
  assert.deepEqual(tree.groups[0].items, [{ type: 'project', id: 'p1' }]);
  assert.deepEqual(service.list(bob).groups, [], 'bob does not see alice groups');
  assert.deepEqual(notified, [alice, alice, alice]);
});

test("someone else's group looks missing, and an item without access is refused", async (t) => {
  const { service, alice, bob } = await fixture(t);
  service.create(alice, { name: 'Мои' });
  for (const act of [
    () => service.update(bob, 'g1', { name: 'Взлом' }),
    () => service.addItem(bob, 'g1', 'project', 'p3'),
    () => service.remove(bob, 'g1'),
  ]) {
    assert.throws(act, (error: { statusCode?: number }) => error.statusCode === 404);
  }
  assert.throws(() => service.addItem(alice, 'g1', 'project', 'p3'), (error: { statusCode?: number }) => error.statusCode === 403);
  assert.throws(() => service.setPin(alice, 's9', true), (error: { statusCode?: number }) => error.statusCode === 403);
});

test('an item sits in one group at a time; rename, collapse, reorder, pins; deleting a group keeps pins and chats', async (t) => {
  const { service, alice } = await fixture(t);
  service.create(alice, { name: 'A' });
  service.create(alice, { name: 'B' });
  service.addItem(alice, 'g1', 'project', 'p1');
  service.addItem(alice, 'g2', 'project', 'p1');
  let tree = service.update(alice, 'g2', { name: 'Бэ', collapsed: true });
  assert.deepEqual(tree.groups.map((group) => group.items.length), [0, 1], 'p1 moved to the second group');
  assert.equal(tree.groups[1].collapsed, true);
  tree = service.reorder(alice, ['g2', 'g1']);
  assert.deepEqual(tree.groups.map((group) => group.name), ['Бэ', 'A']);
  tree = service.setItems(alice, 'g1', [{ type: 'session', id: 's2' }, { type: 'session', id: 's1' }]);
  assert.deepEqual(tree.groups[1].items.map((item) => item.id), ['s2', 's1']);
  tree = service.setPin(alice, 's1', true);
  assert.deepEqual(tree.pins, ['s1']);
  tree = service.remove(alice, 'g1');
  assert.deepEqual(tree.groups.map((group) => group.name), ['Бэ']);
  assert.deepEqual(tree.pins, ['s1']);
  assert.deepEqual(service.setPin(alice, 's1', false).pins, []);
});

test('with the mod off every call is 409 MOD_OFF', async (t) => {
  const { service, alice } = await fixture(t, { modOff: true });
  assert.throws(() => service.list(alice), (error: { statusCode?: number; code?: string }) => error.statusCode === 409);
  assert.throws(() => service.create(alice, { name: 'A' }), (error: { statusCode?: number }) => error.statusCode === 409);
});
