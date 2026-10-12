import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionLinkRef, SessionLinks } from '../../../shared/session-links';

import { buildThreadsBar } from './threadsBarModel';

// Story 30 (R15.1): in the parent chat a strip «Треды: N (работают M)» with a
// way into each thread.

function ref(sessionId: string, overrides: Partial<SessionLinkRef> = {}): SessionLinkRef {
  return { sessionId, relation: 'thread', name: `Тред ${sessionId}`, provider: 'grok', createdAt: null, isArchived: false, ...overrides };
}

function states(entries: Record<string, 'working' | 'waiting' | 'done' | 'failed'>) {
  return new Map(Object.entries(entries).map(([sessionId, state]) => [sessionId, { state }]));
}

test('no threads → no strip', () => {
  assert.equal(buildThreadsBar(undefined, new Map()), null);
  assert.equal(buildThreadsBar({ children: [] }, new Map()), null);
  const relayOnly: SessionLinks = { children: [ref('r1', { relation: 'relay' })] };
  assert.equal(buildThreadsBar(relayOnly, new Map()), null);
});

test('counts threads and the working ones; the caption says both', () => {
  const links: SessionLinks = { children: [ref('a'), ref('b'), ref('c'), ref('r', { relation: 'relay' })] };
  const bar = buildThreadsBar(links, states({ a: 'working', b: 'done', c: 'working' }))!;
  assert.equal(bar.total, 3);
  assert.equal(bar.working, 2);
  assert.equal(bar.label, 'Треды: 3 (работают 2)');
  assert.deepEqual(bar.items.map((item) => item.sessionId), ['a', 'b', 'c']);
});

test('nothing working → the caption has no «работают»', () => {
  const bar = buildThreadsBar({ children: [ref('a')] }, states({ a: 'done' }))!;
  assert.equal(bar.label, 'Треды: 1');
});

test('each thread has its name, state and a state caption', () => {
  const links: SessionLinks = { children: [ref('a'), ref('b', { name: null }), ref('c'), ref('d')] };
  const bar = buildThreadsBar(links, states({ a: 'working', c: 'waiting', d: 'failed' }), 'Новый чат')!;
  assert.deepEqual(bar.items.map((item) => [item.name, item.state, item.stateLabel]), [
    ['Тред a', 'working', 'работает'],
    ['Новый чат', 'idle', 'готов'],
    ['Тред c', 'waiting', 'ждёт ответа'],
    ['Тред d', 'failed', 'ошибка'],
  ]);
});

test('archived threads are not shown', () => {
  const bar = buildThreadsBar({ children: [ref('a'), ref('b', { isArchived: true })] }, new Map())!;
  assert.equal(bar.total, 1);
});
