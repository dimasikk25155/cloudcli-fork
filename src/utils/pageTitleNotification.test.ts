import assert from 'node:assert/strict';
import test from 'node:test';

import { composePageTitle, setPageAttentionCount, setPageBaseTitle } from './pageTitleNotification';

test('tab title carries «(N) » only when someone needs you (R11)', () => {
  assert.equal(composePageTitle({ base: 'neo3 — Neo3 Agent System', count: 3, done: false }), '(3) neo3 — Neo3 Agent System');
  assert.equal(composePageTitle({ base: 'Neo3 Agent System', count: 0, done: false }), 'Neo3 Agent System');
  assert.equal(composePageTitle({ base: 'Neo3 Agent System', count: 1, done: true }), '(1) [Done] Neo3 Agent System');
});

test('switching project keeps the counter; counter change keeps the project name', () => {
  const fakeDocument = { title: '' } as { title: string };
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = fakeDocument;
  try {
    setPageBaseTitle('alpha — Neo3 Agent System');
    setPageAttentionCount(2);
    assert.equal(fakeDocument.title, '(2) alpha — Neo3 Agent System');

    setPageBaseTitle('beta — Neo3 Agent System');
    assert.equal(fakeDocument.title, '(2) beta — Neo3 Agent System');

    setPageAttentionCount(0);
    assert.equal(fakeDocument.title, 'beta — Neo3 Agent System');
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});
