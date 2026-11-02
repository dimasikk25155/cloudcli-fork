import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ImprovementIdea } from '../../../shared/improvement-ideas';

import { IdeaCardsView, ideaRequestReducer } from './IdeaCards';
const idea: ImprovementIdea = { id: 1, sessionId: 'source', projectName: 'Tyres', text: 'Быстрый подбор', status: 'proposed', createdAt: '2026-11-02', vaultPath: null, vaultError: 'Запись не удалась' };

test('cards show exact idea, approval/defer controls and explicit vault retry', () => {
  const html = renderToStaticMarkup(React.createElement(IdeaCardsView, { ideas: [idea], isProcessing: false, pending: null, error: '', onAction: () => {} }));
  for (const label of ['Быстрый подбор', 'Реализовать', 'Позже', 'Повторить запись', '/session/source']) assert.ok(html.includes(label));
  assert.ok(!html.includes('Сохранено в Obsidian'));
});
test('busy disables approval and deferred ideas remain discoverable', () => {
  const busy = renderToStaticMarkup(React.createElement(IdeaCardsView, { ideas: [idea], isProcessing: true, pending: null, error: 'Чат занят', onAction: () => {} }));
  assert.match(busy, /disabled=""/); assert.ok(busy.includes('role="alert"'));
  const later = renderToStaticMarkup(React.createElement(IdeaCardsView, { ideas: [{ ...idea, status: 'later' }], isProcessing: false, pending: null, error: '', onAction: () => {} }));
  assert.ok(later.includes('Все, включая отложенные'));
});

test('successful poll clears a transient load failure but preserves action failure', () => {
  const scope = {};
  let state = { scope, ideas: [idea], loadError: '', actionError: '', pending: null as number | null, revision: 0 };
  state = ideaRequestReducer(state, { scope, type: 'loadFailed', error: 'Загрузка недоступна' });
  state = ideaRequestReducer(state, { scope, type: 'actionFailed', error: 'Чат занят' });
  state = ideaRequestReducer(state, { scope, type: 'loaded', ideas: [idea] });
  assert.equal(state.loadError, '');
  assert.equal(state.actionError, 'Чат занят');
});
test('old action resolving after switching chats cannot mutate new chat pending, errors or ideas', async () => {
  const oldScope = {};
  const newScope = {};
  let state = { scope: oldScope, ideas: [idea], loadError: '', actionError: '', pending: null as number | null, revision: 0 };
  let resolve!: () => void;
  const response = new Promise<void>(done => { resolve = done; });
  state = ideaRequestReducer(state, { scope: oldScope, type: 'actionStarted', id: 1 });
  const oldAction = response.then(() => {
    state = ideaRequestReducer(state, { scope: oldScope, type: 'actionSucceeded', idea: { ...idea, status: 'later' } });
    state = ideaRequestReducer(state, { scope: oldScope, type: 'actionFailed', error: 'Старый запрос' });
    state = ideaRequestReducer(state, { scope: oldScope, type: 'actionFinished' });
  });
  state = ideaRequestReducer(state, { scope: newScope, type: 'reset' });
  state = ideaRequestReducer(state, { scope: newScope, type: 'loaded', ideas: [{ ...idea, id: 2, sessionId: 'new' }] });
  state = ideaRequestReducer(state, { scope: newScope, type: 'actionStarted', id: 2 });
  const current = state;
  resolve(); await oldAction;
  assert.deepEqual(state, current);
});
