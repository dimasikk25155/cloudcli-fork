import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionLinks } from '../../../../shared/session-links.js';

import { buildSessionTree } from './sessionTree.js';

type Row = { id: string; links?: SessionLinks };

const parentRef = (sessionId: string, relation: 'relay' | 'thread' | 'btw') => ({
  sessionId,
  relation,
  name: null,
  provider: 'claude',
  createdAt: null,
  isArchived: false,
});

const child = (id: string, parent: string, relation: 'relay' | 'thread' | 'btw'): Row => ({
  id,
  links: { parent: parentRef(parent, relation), children: [] },
});

const shape = (rows: ReturnType<typeof buildSessionTree<Row>>) =>
  rows.map((row) => `${'  '.repeat(row.depth)}${row.session.id}${row.childCount ? ` (${row.childCount}${row.collapsed ? ', свёрнут' : ''})` : ''}`);

test('children of every relation sit under their parent, grandchildren deeper', () => {
  const sessions: Row[] = [
    { id: 'main' },
    child('btw-1', 'main', 'btw'),
    { id: 'other' },
    child('thread-1', 'main', 'thread'),
    child('relay-1', 'main', 'relay'),
    child('btw-of-thread', 'thread-1', 'btw'),
  ];
  assert.deepEqual(shape(buildSessionTree(sessions, new Set())), [
    'main (3)',
    '  btw-1',
    '  thread-1 (1)',
    '    btw-of-thread',
    '  relay-1',
    'other',
  ]);
});

test('a collapsed parent hides its whole branch, the rest stays', () => {
  const sessions: Row[] = [
    { id: 'main' },
    child('thread-1', 'main', 'thread'),
    child('btw-of-thread', 'thread-1', 'btw'),
    { id: 'other' },
  ];
  assert.deepEqual(shape(buildSessionTree(sessions, new Set(['main']))), ['main (1, свёрнут)', 'other']);
  assert.deepEqual(shape(buildSessionTree(sessions, new Set(['thread-1']))), ['main (1)', '  thread-1 (1, свёрнут)', 'other']);
});

test('a child whose parent is not in the list stays a top-level card', () => {
  const sessions: Row[] = [child('orphan', 'not-loaded', 'btw'), { id: 'main' }];
  assert.deepEqual(shape(buildSessionTree(sessions, new Set())), ['orphan', 'main']);
});

test('broken data with a loop still shows every chat once', () => {
  const sessions: Row[] = [child('a', 'b', 'relay'), child('b', 'a', 'relay'), { id: 'c' }];
  const rows = buildSessionTree(sessions, new Set());
  assert.deepEqual(rows.map((row) => row.session.id).sort(), ['a', 'b', 'c']);
});
