import assert from 'node:assert/strict';
import test from 'node:test';

import type { AttentionItem } from '../types';

import { applySeen, countAttention, describeAttention, groupAttention } from './attentionModel';

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

test('N = waiting + unread failed + unread done; working and seen sessions do not count (R11)', () => {
  const items = [
    item({ sessionId: 'w1', state: 'waiting', reason: 'ask' }),
    item({ sessionId: 'w2', state: 'waiting', reason: 'manual_ask' }),
    item({ sessionId: 'f-new', state: 'failed', reason: 'error', unread: true }),
    item({ sessionId: 'f-seen', state: 'failed', reason: 'error', unread: false }),
    item({ sessionId: 'd-new', state: 'done', unread: true }),
    item({ sessionId: 'd-seen', state: 'done', unread: false }),
    item({ sessionId: 'run', state: 'working' }),
  ];

  const { total, counts } = countAttention(items);

  assert.equal(total, 4);
  assert.deepEqual(counts, { waiting: 2, failed: 1, unreadDone: 1, working: 1 });
});

test('nobody waiting → N is 0', () => {
  assert.equal(countAttention([]).total, 0);
  assert.equal(countAttention([item({ state: 'working' }), item({ state: 'done' })]).total, 0);
});

test('hub groups: Ждут ответа → Упали → Готово → Работают; seen done/failed leave the hub (R13, R14)', () => {
  const items = [
    item({ sessionId: 'run', state: 'working', updatedAt: '2026-10-12T10:05:00.000Z' }),
    item({ sessionId: 'd-seen', state: 'done', unread: false }),
    item({ sessionId: 'd-new', state: 'done', unread: true }),
    item({ sessionId: 'w-late', state: 'waiting', reason: 'ask', updatedAt: '2026-10-12T10:20:00.000Z' }),
    item({ sessionId: 'f-new', state: 'failed', reason: 'error', unread: true }),
    item({ sessionId: 'w-early', state: 'waiting', reason: 'plan', updatedAt: '2026-10-12T09:00:00.000Z' }),
    item({ sessionId: 'f-seen', state: 'failed', reason: 'error', unread: false }),
  ];

  const groups = groupAttention(items);

  assert.deepEqual(
    groups.map((group) => [group.key, group.title, group.items.map((entry) => entry.sessionId)]),
    [
      // Longest wait first: it has been blocking the longest.
      ['waiting', 'Ждут ответа', ['w-early', 'w-late']],
      ['failed', 'Упали', ['f-new']],
      ['done', 'Готово', ['d-new']],
      ['working', 'Работают', ['run']],
    ],
  );
});

test('finished groups list the newest first; empty groups are dropped', () => {
  const groups = groupAttention([
    item({ sessionId: 'old', state: 'done', unread: true, updatedAt: '2026-10-12T08:00:00.000Z' }),
    item({ sessionId: 'new', state: 'done', unread: true, updatedAt: '2026-10-12T11:00:00.000Z' }),
  ]);
  assert.deepEqual(groups.map((group) => group.key), ['done']);
  assert.deepEqual(groups[0].items.map((entry) => entry.sessionId), ['new', 'old']);
  assert.deepEqual(groupAttention([item({ state: 'done', unread: false })]), []);
});

test('waiting and done read differently: own tone and label (R09)', () => {
  const waiting = describeAttention(item({ state: 'waiting', reason: 'plan' }));
  const done = describeAttention(item({ state: 'done', unread: true }));
  const failed = describeAttention(item({ state: 'failed', reason: 'error', unread: true }));

  assert.equal(waiting.statusLabel, 'Ждёт ответа: план');
  assert.equal(done.statusLabel, 'Готово');
  assert.equal(failed.statusLabel, 'Упало');
  assert.equal(new Set([waiting.tone, done.tone, failed.tone]).size, 3);
  assert.equal(describeAttention(item({ state: 'waiting', reason: 'permission' })).statusLabel, 'Ждёт ответа: разрешение');
  assert.equal(describeAttention(item({ state: 'waiting', reason: 'manual_ask' })).statusLabel, 'Ждёт ответа: от тебя действие');
  assert.equal(describeAttention(item({ state: 'waiting', reason: 'text_question' })).statusLabel, 'Ждёт ответа');
});

test('row says how long it waits: «ждёт N мин», hours and days (R13.1)', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const waitingSince = (iso: string) => describeAttention(item({ state: 'waiting', reason: 'ask', updatedAt: iso }), now).ageLabel;

  assert.equal(waitingSince('2026-10-12T11:47:00.000Z'), 'ждёт 13 мин');
  assert.equal(waitingSince('2026-10-12T11:59:40.000Z'), 'ждёт <1 мин');
  assert.equal(waitingSince('2026-10-12T09:30:00.000Z'), 'ждёт 2 ч');
  assert.equal(waitingSince('2026-10-09T12:00:00.000Z'), 'ждёт 3 дн');
  assert.equal(
    describeAttention(item({ state: 'done', unread: true, updatedAt: '2026-10-12T11:55:00.000Z' }), now).ageLabel,
    '5 мин назад',
  );
});

test('the gist of the question is one line, clipped (R13.1)', () => {
  const long = `Какой вариант деплоя выбрать?\n\nВарианты:   ${'очень длинное пояснение '.repeat(20)}`;
  const { summary } = describeAttention(item({ state: 'waiting', reason: 'ask', detail: { question: long } }));

  assert.ok(summary.startsWith('Какой вариант деплоя выбрать? Варианты: очень'));
  assert.ok(!summary.includes('\n'));
  assert.ok(summary.length <= 140);
  assert.ok(summary.endsWith('…'));

  assert.equal(
    describeAttention(item({ state: 'failed', reason: 'error', unread: true, detail: { error: 'API Error: 529 Overloaded' } })).summary,
    'API Error: 529 Overloaded',
  );
  assert.equal(
    describeAttention(item({ state: 'waiting', reason: 'manual_ask', detail: { excerpt: 'Открой настройки и пришли скрин.' } })).summary,
    'Открой настройки и пришли скрин.',
  );
  assert.equal(describeAttention(item({ state: 'working' })).summary, '');
});

test('«всё просмотрено» гасит unread done/failed, waiting stay until answered (R14)', () => {
  const items = [
    item({ sessionId: 'w', state: 'waiting', reason: 'ask' }),
    item({ sessionId: 'f', state: 'failed', reason: 'error', unread: true }),
    item({ sessionId: 'd', state: 'done', unread: true }),
    item({ sessionId: 'run', state: 'working' }),
  ];

  const after = applySeen(items, { all: true });

  assert.equal(countAttention(after).total, 1);
  assert.deepEqual(groupAttention(after).map((group) => group.key), ['waiting', 'working']);
  // The input list is not mutated (React state).
  assert.equal(items[1].unread, true);
});

test('opening one session clears only that session', () => {
  const items = [
    item({ sessionId: 'd1', state: 'done', unread: true }),
    item({ sessionId: 'd2', state: 'done', unread: true }),
  ];
  const after = applySeen(items, { sessionIds: ['d2'] });
  assert.deepEqual(after.map((entry) => [entry.sessionId, entry.unread]), [['d1', true], ['d2', false]]);
});
