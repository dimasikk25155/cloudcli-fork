import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ImprovementIdea } from '../../../shared/improvement-ideas';

import { IdeaCardsView, ideaRequestReducer } from './IdeaCards';
const idea: ImprovementIdea = { id: 1, sessionId: 'source', projectName: 'Tyres', text: 'Быстрый подбор', status: 'proposed', createdAt: '2026-11-02', vaultPath: null, vaultError: 'Запись не удалась' };

test('cards show exact idea, approval/defer controls and explicit vault retry', () => {
  const html = renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'source', ideas: [idea], isProcessing: false, pending: null, error: '', onImplementAll: () => {}, onAction: () => {} }));
  for (const label of ['Быстрый подбор', 'Реализовать', 'Позже', 'Повторить запись']) assert.ok(html.includes(label));
  assert.ok(!html.includes('Сохранено в Obsidian'));
});
test('busy disables approval and deferred ideas remain discoverable', () => {
  const busy = renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'source', ideas: [idea], isProcessing: true, pending: null, error: 'Чат занят', onImplementAll: () => {}, onAction: () => {} }));
  assert.match(busy, /disabled=""/); assert.ok(busy.includes('role="alert"'));
  const later = renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'source', ideas: [{ ...idea, status: 'later' }], isProcessing: false, pending: null, error: '', onImplementAll: () => {}, onAction: () => {} }));
  assert.ok(later.includes('Отложено'));
  assert.ok(later.includes('Реализовать'));
  assert.doesNotMatch(later, /<details[^>]* open/);
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


test('chat tray starts collapsed and includes every current-chat idea without other chats', () => {
  const ideas = Array.from({ length: 6 }, (_, index) => ({ ...idea, id: index + 1, text: `Current idea ${index}` }));
  ideas.push({ ...idea, id: 99, sessionId: 'another', text: 'Other chat private idea' });
  const html = renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'source', ideas, isProcessing: false, pending: null, error: '', onImplementAll: () => {}, onAction: () => {} }));
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.ok(html.includes('Идеи этого чата'));
  for (let i = 0; i < 6; i++) assert.ok(html.includes(`Current idea ${i}`));
  assert.ok(!html.includes('Other chat private idea'));
  assert.equal((html.match(/<article/g) || []).length, 6);
});

test('ideas from other chats do not create an empty tray', () => {
  assert.equal(renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'another', ideas: [idea], isProcessing: false, pending: null, error: '', onImplementAll: () => {}, onAction: () => {} })), '');
});


test('batch button counts only unstarted ideas in this chat including deferred and disables while busy', () => {
  const ideas: ImprovementIdea[] = [idea, { ...idea, id: 2, status: 'later' }, { ...idea, id: 3, status: 'started' }, { ...idea, id: 4, status: 'starting' }, { ...idea, id: 5, sessionId: 'other' }];
  const render = (isProcessing: boolean, pending: number | null) => renderToStaticMarkup(React.createElement(IdeaCardsView, { sessionId: 'source', ideas, isProcessing, pending, error: '', onImplementAll: () => {}, onAction: () => {} }));
  assert.match(render(false, null), /Реализовать всё · 2/);
  assert.match(render(true, null), /<button[^>]*disabled=""[^>]*>Реализовать всё · 2/);
  assert.match(render(false, -1), /<button[^>]*disabled=""[^>]*>Запускаю…/);
});

test('batch results update all returned cards, preserve new ideas and ignore previous chat responses', () => {
  const scope = {}; const other = {};
  const state = { scope, ideas: [idea, { ...idea, id: 2 }, { ...idea, id: 3 }], pending: -1, loadError: '', actionError: '', revision: 0 };
  const updates: ImprovementIdea[] = [ { ...idea, status: 'started' }, { ...idea, id: 2, status: 'started' } ];
  const event = { scope, type: 'batchSucceeded' as const, ideas: updates };
  assert.deepEqual(ideaRequestReducer(state, event).ideas.map(row => row.status), ['started', 'started', 'proposed']);
  assert.equal(ideaRequestReducer(state, { ...event, scope: other }), state);
});
