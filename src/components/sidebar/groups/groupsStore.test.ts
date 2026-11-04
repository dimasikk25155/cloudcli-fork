import assert from 'node:assert/strict';
import test from 'node:test';

import { createGroupsStore } from './groupsStore';

test('an action sends the change and takes the answered tree; a refusal keeps the old tree', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  let status = 200;
  const tree = { groups: [{ id: 'g1', name: 'А', collapsed: false, items: [] }], pins: ['s1'] };
  const store = createGroupsStore(async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    return { ok: status === 200, json: async () => ({ success: true, data: tree }) };
  });
  let notified = 0;
  store.subscribe(() => { notified += 1; });

  await store.create('А');
  assert.deepEqual(calls[0], { url: '/api/sidebar-groups', method: 'POST', body: '{"name":"А"}' });
  assert.deepEqual(store.get(), tree);
  assert.equal(notified, 1);

  status = 409;
  await store.rename('g1', 'Б');
  assert.deepEqual(store.get(), tree, 'MOD_OFF leaves the tree as it was');
  assert.equal(calls[1].url, '/api/sidebar-groups/g1');

  status = 200;
  await store.unpin('s 1');
  assert.deepEqual([calls[2].url, calls[2].method], ['/api/sidebar-groups/pins/s%201', 'DELETE']);
});
