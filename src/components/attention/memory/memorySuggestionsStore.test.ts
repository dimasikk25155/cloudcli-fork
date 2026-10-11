import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemorySuggestionsStore, type MemorySuggestion } from './memorySuggestionsStore';

// Spec story 47–48 on the client: a proposed note is shown until Dima acts;
// after «Записать» the card stays with the path, after «Не надо» it is gone.

const NOTE: MemorySuggestion = {
  id: 4,
  sessionId: 'sess-1',
  sessionTitle: 'Чиню хук',
  projectName: 'neo3',
  title: 'Stop hook exits inside Neo3',
  folder: 'wiki/synthesis',
  body: '---\ncreated: 2026-10-12\n---\n# Stop hook exits inside Neo3\n',
  createdAt: '2026-10-12T12:00:00.000Z',
};

function fakeServer(list: MemorySuggestion[]) {
  let rows = list;
  return {
    fetchList: async () => rows,
    postWrite: async (id: number) => {
      rows = rows.filter((row) => row.id !== id);
      return { path: '/vault/wiki/synthesis/stop-hook-exits-inside-neo3.md' };
    },
    postDismiss: async (id: number) => {
      rows = rows.filter((row) => row.id !== id);
    },
  };
}

test('after «Записать» the card keeps showing, now with the written path', async () => {
  const store = createMemorySuggestionsStore(fakeServer([NOTE]));
  await store.refresh();

  await store.write(NOTE.id);
  await store.refresh();

  const [entry] = store.forSession('sess-1');
  assert.equal(entry.suggestion.title, 'Stop hook exits inside Neo3');
  assert.equal(entry.writtenPath, '/vault/wiki/synthesis/stop-hook-exits-inside-neo3.md');
  assert.equal(store.getSnapshot().pendingCount, 0, 'a written note no longer counts as waiting');
});

test('after «Не надо» the card is gone', async () => {
  const store = createMemorySuggestionsStore(fakeServer([NOTE]));
  await store.refresh();

  await store.dismiss(NOTE.id);
  await store.refresh();

  assert.deepEqual(store.forSession('sess-1'), []);
  assert.equal(store.getSnapshot().pendingCount, 0);
});

test('a failed write keeps the card with an error, and it can be retried', async () => {
  const server = fakeServer([NOTE]);
  let fail = true;
  const store = createMemorySuggestionsStore({
    ...server,
    postWrite: async (id) => {
      if (fail) throw new Error('Вольт не найден');
      return server.postWrite(id);
    },
  });
  await store.refresh();

  await store.write(NOTE.id);
  assert.equal(store.forSession('sess-1')[0].error, 'Вольт не найден');
  assert.equal(store.forSession('sess-1')[0].writtenPath, null);

  fail = false;
  await store.write(NOTE.id);
  assert.equal(store.forSession('sess-1')[0].writtenPath, '/vault/wiki/synthesis/stop-hook-exits-inside-neo3.md');
});
