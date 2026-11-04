import assert from 'node:assert/strict';
import test from 'node:test';

import type { AttentionItem } from '../attention/types';

import { canMarkAllRead, canMarkRead, sessionHubBar, sessionHubGroups } from './sessionHubModel';

// Полоса «работают N · ждут N · готово N» и списки боковой панели — по
// статусам «Ждут тебя» всех движков (история 19).

function item(sessionId: string, overrides: Partial<AttentionItem>): AttentionItem {
  return {
    sessionId,
    projectId: 'p1',
    projectName: 'Проект',
    provider: 'claude',
    title: sessionId,
    state: 'working',
    reason: null,
    detail: null,
    updatedAt: '2026-11-04T10:00:00.000Z',
    unread: false,
    ...overrides,
  };
}

const ITEMS: AttentionItem[] = [
  item('claude-run', { provider: 'claude', state: 'working' }),
  item('codex-run', { provider: 'codex', state: 'working' }),
  item('grok-ask', { provider: 'grok', state: 'waiting', reason: 'ask', detail: { requestId: 'r1' } }),
  item('codex-soft-read', { provider: 'codex', state: 'waiting', reason: 'manual_ask', unread: false }),
  item('claude-done', { state: 'done', unread: true, updatedAt: '2026-11-04T10:05:00.000Z' }),
  item('grok-done-read', { provider: 'grok', state: 'done', unread: false, updatedAt: '2026-11-04T09:00:00.000Z' }),
  item('codex-failed', { provider: 'codex', state: 'failed', reason: 'error', unread: true }),
];

test('bar: counts working, waiting and unread done across every engine', () => {
  const bar = sessionHubBar(ITEMS);
  assert.deepEqual(bar.counts, { working: 2, waiting: 1, done: 1, failed: 1 });
  assert.equal(bar.label, 'работают 2 · ждут 1 · готово 1 · упали 1');
  assert.equal(bar.visible, true);
});

test('bar: nothing going on → hidden; failed part only when something failed', () => {
  assert.equal(sessionHubBar([]).visible, false);
  assert.equal(sessionHubBar([item('a', { state: 'done', unread: false })]).visible, false);
  assert.equal(sessionHubBar([item('a', { state: 'working' })]).label, 'работают 1 · ждут 0 · готово 0');
});

test('panel: groups by state in the order «ждут, работают, упали, готово», newest first', () => {
  const groups = sessionHubGroups(ITEMS);
  assert.deepEqual(groups.map((group) => [group.key, group.items.map((entry) => entry.sessionId)]), [
    ['waiting', ['grok-ask', 'codex-soft-read']],
    ['working', ['claude-run', 'codex-run']],
    ['failed', ['codex-failed']],
    ['done', ['claude-done', 'grok-done-read']],
  ]);
  assert.deepEqual(groups.map((group) => group.title), ['Ждут', 'Работают', 'Упали', 'Готово']);
});

test('«прочитано» only for unread finished chats and soft questions, never for working or open requests', () => {
  const byId = new Map(ITEMS.map((entry) => [entry.sessionId, entry]));
  assert.equal(canMarkRead(byId.get('claude-done')!), true);
  assert.equal(canMarkRead(byId.get('codex-failed')!), true);
  assert.equal(canMarkRead(byId.get('grok-done-read')!), false);
  assert.equal(canMarkRead(byId.get('claude-run')!), false);
  assert.equal(canMarkRead(byId.get('grok-ask')!), false);
  assert.equal(canMarkRead(item('soft', { state: 'waiting', reason: 'text_question', unread: true })), true);
});

test('«Прочитать всё» is offered only while something can be marked read', () => {
  assert.equal(canMarkAllRead(ITEMS), true);
  // Only working chats, open requests and already-read ones — nothing to mark.
  const nothing = [
    item('run', { state: 'working', unread: true }),
    item('ask', { state: 'waiting', reason: 'ask', detail: { requestId: 'r1' }, unread: true }),
    item('read', { state: 'done', unread: false }),
  ];
  assert.equal(canMarkAllRead(nothing), false);
  assert.equal(canMarkAllRead([]), false);
});
