import assert from 'node:assert/strict';
import test from 'node:test';

import type { AttentionItem, AttentionSeenTarget } from './types';
import { createAttentionStore } from './attentionStore';

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    sessionId: 's',
    projectId: 'p1',
    projectName: 'neo3',
    provider: 'claude',
    title: null,
    state: 'done',
    reason: null,
    detail: null,
    updatedAt: '2026-10-12T10:00:00.000Z',
    unread: false,
    ...overrides,
  };
}

function fakeServer(initial: AttentionItem[]) {
  let rows = initial;
  const seenCalls: AttentionSeenTarget[] = [];
  return {
    seenCalls,
    set(next: AttentionItem[]) {
      rows = next;
    },
    deps: {
      fetchList: async () => rows,
      postSeen: async (target: AttentionSeenTarget) => {
        seenCalls.push(target);
        const ids = 'all' in target ? null : new Set(target.sessionIds);
        rows = rows.map((row) => (
          (row.state === 'done' || row.state === 'failed') && (!ids || ids.has(row.sessionId))
            ? { ...row, unread: false }
            : row
        ));
      },
      isPageVisible: () => true,
    },
  };
}

test('«Всё просмотрено» empties N right away and tells the server once (R14)', async () => {
  const server = fakeServer([
    item({ sessionId: 'w', state: 'waiting', reason: 'ask' }),
    item({ sessionId: 'd', state: 'done', unread: true }),
    item({ sessionId: 'f', state: 'failed', reason: 'error', unread: true }),
  ]);
  const store = createAttentionStore(server.deps);
  await store.refresh();
  assert.equal(store.getSnapshot().total, 3);

  const pending = store.markSeen({ all: true });
  // Optimistic: the counter drops before the server answers.
  assert.equal(store.getSnapshot().total, 1);
  await pending;

  assert.deepEqual(server.seenCalls, [{ all: true }]);
  assert.equal(store.getSnapshot().total, 1);
});

test('opening a session marks it seen; waiting sessions and already-seen ones send nothing', async () => {
  const server = fakeServer([
    item({ sessionId: 'done-new', state: 'done', unread: true }),
    item({ sessionId: 'waiting', state: 'waiting', reason: 'plan' }),
    item({ sessionId: 'done-old', state: 'done', unread: false }),
  ]);
  const store = createAttentionStore(server.deps);
  await store.refresh();

  await store.setViewedSession('waiting');
  await store.setViewedSession('done-old');
  assert.deepEqual(server.seenCalls, []);

  await store.setViewedSession('done-new');
  assert.deepEqual(server.seenCalls, [{ sessionIds: ['done-new'] }]);
  assert.equal(store.getSnapshot().total, 1);
});

test('a session that finishes while it is open on screen does not light up', async () => {
  const server = fakeServer([item({ sessionId: 'open', state: 'working' })]);
  const store = createAttentionStore(server.deps);
  await store.setViewedSession('open');
  await store.refresh();

  server.set([item({ sessionId: 'open', state: 'done', unread: true, updatedAt: '2026-10-12T10:05:00.000Z' })]);
  await store.refresh();

  assert.deepEqual(server.seenCalls, [{ sessionIds: ['open'] }]);
  assert.equal(store.getSnapshot().total, 0);
});

test('re-reading an unchanged list keeps item identity and does not notify (no sidebar re-render)', async () => {
  const rows = () => [
    item({ sessionId: 'a', state: 'waiting', reason: 'ask', detail: { question: 'Деплоить?', options: ['Да', 'Нет'] } }),
    item({ sessionId: 'b', state: 'done', unread: true }),
  ];
  let served = rows();
  const store = createAttentionStore({ fetchList: async () => served, postSeen: async () => {}, isPageVisible: () => true });
  await store.refresh();
  const first = store.getSnapshot();
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });

  // Same content, brand-new objects — exactly what a poll returns.
  served = rows();
  await store.refresh();
  assert.equal(notified, 0);
  assert.equal(store.getSnapshot(), first);

  // One session changes: only its element gets a new reference.
  served = [rows()[0], item({ sessionId: 'b', state: 'done', unread: false })];
  await store.refresh();
  assert.equal(notified, 1);
  const next = store.getSnapshot();
  assert.equal(next.items[0], first.items[0]);
  assert.notEqual(next.items[1], first.items[1]);
  assert.equal(next.byId.get('a'), first.items[0]);
});

test('«просмотрено» pressed while a poll is in flight: the stale answer never brings unread back', async () => {
  let serverUnread = true;
  const serverRows = () => [item({ sessionId: 'd', state: 'done', unread: serverUnread })];
  let releaseStale: (() => void) | null = null;
  let call = 0;
  const store = createAttentionStore({
    fetchList: async () => {
      call += 1;
      if (call === 2) {
        // The poll read the server BEFORE the seen-write landed.
        const stale = serverRows();
        await new Promise<void>((resolve) => {
          releaseStale = resolve;
        });
        return stale;
      }
      return serverRows();
    },
    postSeen: async () => {
      serverUnread = false;
    },
    isPageVisible: () => true,
  });
  await store.refresh();
  assert.equal(store.getSnapshot().total, 1);

  const poll = store.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const totalsAfterSeen: number[] = [];
  await store.markSeen({ all: true });
  store.subscribe(() => totalsAfterSeen.push(store.getSnapshot().total));
  assert.equal(store.getSnapshot().total, 0);

  releaseStale!();
  await poll;

  assert.equal(store.getSnapshot().total, 0);
  assert.equal(store.getSnapshot().items[0].unread, false);
  assert.ok(!totalsAfterSeen.includes(1), `unread came back: ${totalsAfterSeen.join(',')}`);
});

test('a failed load keeps the last known list and counter', async () => {
  let fail = false;
  const store = createAttentionStore({
    fetchList: async () => {
      if (fail) throw new Error('502 Bad Gateway');
      return [item({ sessionId: 'w', state: 'waiting', reason: 'ask' }), item({ sessionId: 'f', state: 'failed', reason: 'error', unread: true })];
    },
    postSeen: async () => {},
    isPageVisible: () => true,
  });
  await store.refresh();

  fail = true;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await store.refresh();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(store.getSnapshot().total, 2);
  assert.deepEqual(store.getSnapshot().items.map((entry) => entry.sessionId), ['w', 'f']);
  assert.equal(store.getSnapshot().loaded, true);
});
