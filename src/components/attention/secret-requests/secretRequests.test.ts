import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SecretRequestCard from './SecretRequestCard';
import { createSecretRequestsStore, secretCardTitle, type SecretRequest } from './secretRequestsStore';

// «Запрос ключа» on the client: the card shows the name and the reason, the
// field is hidden, and the value lives only in the field until it is sent.

const VALUE = 'sk-FakeClientValue-0123456789';

const REQUEST: SecretRequest = {
  id: 'req-1',
  sessionId: 'chat-1',
  sessionTitle: 'Samruk: страница',
  name: 'FB_PAGE_TOKEN',
  why: 'постинг на страницу',
  createdAt: '2026-11-05T10:00:00.000Z',
  exists: false,
};

function fakeServer(rows: SecretRequest[], options: { fail?: string } = {}) {
  let list = rows;
  const posted: Array<{ id: string; value: string; replace: boolean }> = [];
  return {
    posted,
    deps: {
      fetchList: async () => list,
      postAnswer: async (id: string, body: { value: string; replace: boolean }) => {
        posted.push({ id, ...body });
        if (options.fail) throw new Error(options.fail);
        list = list.filter((row) => row.id !== id);
        return { name: 'FB_PAGE_TOKEN', message: 'FB_PAGE_TOKEN сохранён в файле секретов' };
      },
      postDecline: async (id: string) => {
        list = list.filter((row) => row.id !== id);
      },
    },
  };
}

describe('secret requests on the client', () => {
  it('card title: «Агент просит ключ NAME: why»', () => {
    assert.equal(secretCardTitle(REQUEST), 'Агент просит ключ FB_PAGE_TOKEN: постинг на страницу');
  });

  it('saving hands the value to the POST only; the store never keeps it, neither while sending nor after', async () => {
    const server = fakeServer([REQUEST]);
    const store = createSecretRequestsStore(server.deps);
    await store.refresh();
    assert.equal(store.getSnapshot().entries.length, 1);

    const snapshots: string[] = [];
    const unsubscribe = store.subscribe(() => snapshots.push(JSON.stringify(store.getSnapshot())));
    await store.answer('req-1', VALUE, false);
    unsubscribe();

    assert.deepEqual(server.posted, [{ id: 'req-1', value: VALUE, replace: false }]);
    assert.ok(snapshots.length > 0);
    for (const snapshot of snapshots) assert.equal(snapshot.includes(VALUE), false);
    assert.deepEqual(store.getSnapshot().entries, []);
    assert.equal(store.getSnapshot().lastMessage, 'FB_PAGE_TOKEN сохранён в файле секретов');
  });

  it('a refusal stays on the card as text; the value is not in it', async () => {
    const server = fakeServer([REQUEST], { fail: 'Такой ключ уже есть — отметь «Заменить», если его нужно перезаписать' });
    const store = createSecretRequestsStore(server.deps);
    await store.refresh();
    await store.answer('req-1', VALUE, false);
    const [entry] = store.getSnapshot().entries;
    assert.match(entry.error ?? '', /уже есть/);
    assert.equal(entry.busy, null);
    assert.equal(JSON.stringify(store.getSnapshot()).includes(VALUE), false);
  });

  it('decline removes the card', async () => {
    const store = createSecretRequestsStore(fakeServer([REQUEST]).deps);
    await store.refresh();
    assert.equal(store.getSnapshot().entries.length, 1);
    await store.decline('req-1');
    assert.deepEqual(store.getSnapshot().entries, []);
  });

  it('the field is hidden and not autofilled; «Заменить» is offered when the name exists', () => {
    const html = renderToStaticMarkup(React.createElement(SecretRequestCard, {
      entry: { request: { ...REQUEST, exists: true }, busy: null, error: null },
      onSave: () => {},
      onDecline: () => {},
    }));
    assert.match(html, /Агент просит ключ FB_PAGE_TOKEN/);
    assert.match(html, /<input[^>]*type="password"[^>]*>/);
    assert.match(html, /<input[^>]*type="password"[^>]*autoComplete="off"|<input[^>]*autoComplete="off"[^>]*type="password"/i);
    assert.match(html, /Заменить/);
    assert.match(html, /уже есть/);
  });
});
