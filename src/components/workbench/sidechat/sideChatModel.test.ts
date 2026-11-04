import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chatPickerChoices,
  chatSendFrame,
  createSideChatStore,
  feedRows,
  sideChatTabFor,
} from './sideChatModel.js';

test('the second chat sends into the session of its tab, never into the chat the canvas belongs to', () => {
  const frame = chatSendFrame(
    { kind: 'chat', ref: 'second-session' },
    '  проверь логи  ',
    { model: 'grok-4.7', effort: null, permissionMode: 'bypassPermissions' },
  );
  assert.ok(frame);
  assert.equal(frame.type, 'chat.send');
  assert.equal(frame.sessionId, 'second-session');
  assert.equal(frame.content, 'проверь логи');
  assert.equal(frame.options.model, 'grok-4.7');
  assert.equal(frame.options.permissionMode, 'bypassPermissions');
  assert.equal('effort' in frame.options, false);

  // A side chat tab targets its own child chat too.
  assert.equal(chatSendFrame({ kind: 'btw', ref: 'child-1' }, 'ещё вопрос', null)?.sessionId, 'child-1');
  // No session picked yet / nothing typed → nothing is sent anywhere.
  assert.equal(chatSendFrame({ kind: 'chat' }, 'текст', null), null);
  assert.equal(chatSendFrame({ kind: 'chat', ref: 'second-session' }, '   ', null), null);
});

test('a side chat opens as a btw tab of the parent canvas; each child is its own tab', () => {
  assert.deepEqual(sideChatTabFor({ sessionId: 'child-1', title: 'Побочный: зачем индекс' }), {
    kind: 'btw',
    ref: 'child-1',
    title: 'Побочный: зачем индекс',
  });
  assert.notEqual(sideChatTabFor({ sessionId: 'child-1', title: 'a' }).ref, sideChatTabFor({ sessionId: 'child-2', title: 'a' }).ref);
});

test('the feed shows what people typed: the hidden side-chat context is cut', () => {
  const rows = feedRows([
    { id: 'u1', kind: 'text', role: 'user', content: 'зачем индекс?\n\n<btw_context>\nЦитата: CREATE INDEX\n</btw_context>' },
    { id: 't1', kind: 'tool_use', toolName: 'Read' },
    { id: 'a1', kind: 'text', role: 'assistant', content: 'Чтобы поиск был быстрым.' },
    { id: 'h1', kind: 'text', role: 'user', content: 'Stop hook feedback: …' },
    { id: 's1', kind: 'status', content: 'token_budget' },
  ]);
  assert.deepEqual(rows.map((row) => [row.role, row.text]), [
    ['user', 'зачем индекс?'],
    ['tool', 'Read'],
    ['assistant', 'Чтобы поиск был быстрым.'],
  ]);
});

test('drafts live outside the pane: switching tabs and coming back keeps the text', () => {
  const store = createSideChatStore();
  store.setDraft('btw:child-1', 'недописанный вопрос');
  store.setScroll('btw:child-1', 120);
  assert.equal(store.getDraft('btw:child-1'), 'недописанный вопрос');
  assert.equal(store.getScroll('btw:child-1'), 120);
  assert.equal(store.getDraft('btw:child-2'), '');
  store.setDraft('btw:child-1', '');
  assert.equal(store.getDraft('btw:child-1'), '');
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
