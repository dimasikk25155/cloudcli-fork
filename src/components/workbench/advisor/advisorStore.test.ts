import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdvisorStore } from './advisorStore';

test('entries survive per chat and carry pending, answer and error states', () => {
  const store = createAdvisorStore();
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  const first = store.start('s1', 'что думаешь?');
  const other = store.start('s2', 'другой чат');
  assert.equal(store.hasPending('s1'), true);
  store.resolve('s1', first, 'Проверь миграцию');
  store.fail('s2', other, 'лимит');
  assert.deepEqual(store.entries('s1').map((e) => [e.status, e.answer]), [['done', 'Проверь миграцию']]);
  assert.deepEqual(store.entries('s2').map((e) => [e.status, e.error]), [['error', 'лимит']]);
  assert.equal(store.hasPending('s1'), false);
  assert.equal(store.entries('nope').length, 0);
  assert.equal(notified, 4);
});
