import assert from 'node:assert/strict';
import test from 'node:test';

import { pickAttentionItems } from './plannerAttention.js';

test('picks overdue, today and next 3 days; skips farther events, far subs and cards', () => {
  const items = pickAttentionItems({
    events: [
      { row: 7, title: 'Соцзащита', date: '2026-09-01', time: '10:00', kind: 'overdue', when: '01.09 в 10:00' },
      { row: 4, title: 'Завтра', date: '2026-09-04', time: '', kind: 'upcoming', when: '04.09' },
      { row: 8, title: 'Сегодня', date: '2026-09-03', time: '', kind: 'due', when: '03.09' },
      { row: 11, title: 'Через неделю', date: '2026-09-10', time: '', kind: 'upcoming', when: '10.09' },
      { row: 12, title: 'Ровно через 3 дня', date: '2026-09-06', time: '', kind: 'upcoming', when: '06.09' },
    ],
    cards: [{ row: 2 }],
    subs: [
      { row: 3, name: 'Proxy', day: '5', amount: '199', daysLeft: 2, kind: 'upcoming' },
      { row: 5, name: 'Cursor', day: '10', amount: '20', daysLeft: 7, kind: 'upcoming' },
      { row: 6, name: 'Старая', day: '1', amount: '10', daysLeft: 28, kind: 'overdue' },
    ],
  }, '2026-09-03');

  assert.deepEqual(
    items.map((item) => item.key),
    ['event:7', 'event:4', 'event:8', 'event:12', 'sub:3', 'sub:6'],
  );
  assert.match(items[0].label, /Соцзащита/);
  assert.match(items.find((item) => item.key === 'sub:3')?.label || '', /Подписка «Proxy»/);
});

test('empty planner is a clean bell', () => {
  assert.deepEqual(pickAttentionItems(null), []);
  assert.deepEqual(pickAttentionItems({ events: [], subs: [] }), []);
});
