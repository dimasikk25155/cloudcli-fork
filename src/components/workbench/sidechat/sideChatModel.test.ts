import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatPickerChoices,
  createSideChatStore,
  paneSession,
  sameSessionView,
  sideChatTabFor,
} from './sideChatModel.js';

test('a side chat opens as a btw tab of the parent canvas; each child is its own tab', () => {
  assert.deepEqual(sideChatTabFor({ sessionId: 'child-1', title: 'Побочный: зачем индекс' }), {
    kind: 'btw',
    ref: 'child-1',
    title: 'Побочный: зачем индекс',
  });
  assert.notEqual(sideChatTabFor({ sessionId: 'child-1', title: 'a' }).ref, sideChatTabFor({ sessionId: 'child-2', title: 'a' }).ref);
});

test('the engine a side chat was created with is kept by session id', () => {
  const store = createSideChatStore();
  store.setEngine('child-1', { provider: 'grok', model: 'grok-4.7', effort: null, permissionMode: 'bypassPermissions' });
  assert.equal(store.getEngine('child-1')?.provider, 'grok');
  assert.equal(store.getEngine('child-2'), null);
});

test('the session picker offers the project chats except the one the canvas belongs to, newest first', () => {
  const choices = chatPickerChoices(
    [
      { id: 'main', summary: 'Основной', lastActivity: '2026-11-04T10:00:00Z' },
      { id: 'old', summary: 'Старый', lastActivity: '2026-11-01T10:00:00Z' },
      { id: 'new', name: 'Новый', lastActivity: '2026-11-04T11:00:00Z' },
    ],
    'main',
  );
  assert.deepEqual(choices.map((choice) => [choice.sessionId, choice.title]), [['new', 'Новый'], ['old', 'Старый']]);
});

test('a chat of the project opens as that session, with its engine and project filled in', () => {
  const session = paneSession(
    [{ id: 'other' }, { id: 's-2', provider: 'codex', summary: 'Разбор логов', model: 'gpt-5' }],
    's-2',
    null,
    { projectId: 'p-1' },
    'Вкладка',
  );
  assert.equal(session.id, 's-2');
  assert.equal(session.__provider, 'codex');
  assert.equal(session.__projectId, 'p-1');
  assert.equal(session.summary, 'Разбор логов');
  assert.equal(session.model, 'gpt-5');
});

test('a fresh /btw chat not yet in the project list still opens: built from id, engine and project', () => {
  const session = paneSession([{ id: 'parent' }], 'child-9', { provider: 'grok', model: 'grok-4.7' }, { projectId: 'p-1' }, 'Побочный: зачем индекс');
  assert.deepEqual(
    { id: session.id, provider: session.__provider, projectId: session.__projectId, summary: session.summary },
    { id: 'child-9', provider: 'grok', projectId: 'p-1', summary: 'Побочный: зачем индекс' },
  );
  // No engine known at all → Claude, like a side chat opened from an old tab.
  assert.equal(paneSession([], 'child-10', null, { projectId: 'p-1' }, 't').__provider, 'claude');
});

test('a refreshed project list with the same chat data keeps the same session for the chat pane', () => {
  const a = paneSession([{ id: 's', provider: 'claude', summary: 'x', lastActivity: '1' }], 's', null, { projectId: 'p' }, 't');
  const b = paneSession([{ id: 's', provider: 'claude', summary: 'x', lastActivity: '2' }], 's', null, { projectId: 'p' }, 't');
  const renamed = paneSession([{ id: 's', provider: 'claude', summary: 'y' }], 's', null, { projectId: 'p' }, 't');
  assert.equal(sameSessionView(a, b), true);
  assert.equal(sameSessionView(a, renamed), false);
});
