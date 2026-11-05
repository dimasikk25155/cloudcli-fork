import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNotificationPayload, createNotificationEvent } from '@/modules/notifications/index.js';

type Payload = { title?: string; body?: string; data: Record<string, unknown> };

function payloadOf(code: string, meta: Record<string, unknown>): Payload {
  return buildNotificationPayload(createNotificationEvent({ provider: 'system', kind: 'info', code, meta })) as unknown as Payload;
}

test('queue.done opens the «Конвейер» panel with the итог in the body', () => {
  const payload = payloadOf('queue.done', { title: 'Конвейер «Pirelli»', body: '18 OK, 2 брак', queueId: 'q1' });
  assert.equal(payload.title, 'Конвейер «Pirelli»');
  assert.equal(payload.body, '18 OK, 2 брак');
  assert.equal(payload.data.urlPath, '/?panel=queue');
  assert.equal(payload.data.panel, 'queue');
  assert.equal(payload.data.tag, 'queue:q1');
});

test('schedule.result opens «Расписания»; one tag per schedule', () => {
  const payload = payloadOf('schedule.result', { title: 'Расписание «Бриф»', body: 'Ошибка: нет сети', scheduleId: 7 });
  assert.equal(payload.title, 'Расписание «Бриф»');
  assert.equal(payload.body, 'Ошибка: нет сети');
  assert.equal(payload.data.urlPath, '/?panel=schedules');
  assert.equal(payload.data.tag, 'schedule:7');
});
