import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attemptsLabel,
  canMarkOk,
  countsLine,
  emptyQueueForm,
  itemsFromText,
  itemStatusLabel,
  progressPercent,
  queueActions,
  queueStatusLabel,
  templateNote,
  toQueuePayload,
  validateQueueForm,
  type QueueItem,
  type QueueSummary,
} from './agentQueueModel';

const counts = { pending: 2, running: 1, ok: 5, rejected: 2, total: 10 };

function queue(patch: Partial<QueueSummary> = {}): QueueSummary {
  return {
    id: 'q1', agentId: 'a1', agentName: 'Художник', title: 'Pirelli', template: 'Карточка {{item}}',
    parallel: 2, maxAttempts: 3, status: 'running', createdAt: '', updatedAt: '', finishedAt: null, counts, ...patch,
  };
}

function item(patch: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1, position: 1, input: 'P Zero 245/45', status: 'pending', attempts: 0, pass: 1, verdict: null,
    reason: null, excerpt: null, sessionId: null, manual: false, updatedAt: '', ...patch,
  };
}

describe('agent queue model', () => {
  it('items: one per line, blank lines and edge spaces dropped', () => {
    assert.deepEqual(itemsFromText(' a \n\n b\r\n   \nc'), ['a', 'b', 'c']);
    assert.deepEqual(itemsFromText('   '), []);
  });

  it('form: agent and at least one item required; limits 500 items × 2000 chars, parallel 1–3, attempts 1–4', () => {
    const form = { ...emptyQueueForm('a1'), itemsText: 'one\ntwo' };
    assert.deepEqual(validateQueueForm(form), {});
    assert.match(validateQueueForm({ ...form, agentId: '' }).agentId ?? '', /агента/);
    assert.match(validateQueueForm({ ...form, itemsText: ' \n ' }).items ?? '', /нет пунктов/i);
    assert.match(validateQueueForm({ ...form, itemsText: Array.from({ length: 501 }, (_, i) => `p${i}`).join('\n') }).items ?? '', /500/);
    assert.match(validateQueueForm({ ...form, itemsText: `ok\n${'x'.repeat(2001)}` }).items ?? '', /Пункт 2/);
    assert.match(validateQueueForm({ ...form, parallel: 4 }).parallel ?? '', /1 до 3/);
    assert.match(validateQueueForm({ ...form, maxAttempts: 0 }).maxAttempts ?? '', /1 до 4/);
  });

  it('payload: the server shape, items as a list, empty title left to the server', () => {
    const payload = toQueuePayload({ agentId: 'a1', title: '  ', template: ' Сделай {{item}} ', itemsText: 'x\ny', parallel: 2, maxAttempts: 4 });
    assert.deepEqual(payload, { agentId: 'a1', title: undefined, template: 'Сделай {{item}}', items: ['x', 'y'], parallel: 2, maxAttempts: 4 });
  });

  it('template note: without {{item}} the item is appended at the end', () => {
    assert.equal(templateNote('Сделай {{item}}'), null);
    assert.match(templateNote('Сделай карточку') ?? '', /в конец/);
    assert.match(templateNote('') ?? '', /пункт целиком/);
  });

  it('counts and progress in words', () => {
    assert.equal(countsLine(counts), 'в работе 1 · OK 5 · брак 2 · ждут 2');
    assert.equal(progressPercent(counts), 70);
    assert.equal(progressPercent({ pending: 0, running: 0, ok: 0, rejected: 0, total: 0 }), 0);
  });

  it('statuses read as words', () => {
    assert.equal(queueStatusLabel('running'), 'идёт');
    assert.equal(queueStatusLabel('paused'), 'на паузе');
    assert.equal(queueStatusLabel('stopped'), 'остановлена');
    assert.equal(queueStatusLabel('done'), 'готово');
    assert.equal(itemStatusLabel(item()), 'ждёт');
    assert.equal(itemStatusLabel(item({ verdict: 'fail', attempts: 1 })), 'ждёт переделки');
    assert.equal(itemStatusLabel(item({ status: 'running' })), 'в работе');
    assert.equal(itemStatusLabel(item({ status: 'ok', verdict: 'ok' })), 'OK');
    assert.equal(itemStatusLabel(item({ status: 'ok', manual: true })), 'OK (вручную)');
    assert.equal(itemStatusLabel(item({ status: 'rejected' })), 'брак');
  });

  it('attempts: «попытка N из M», the pass from the second one on', () => {
    assert.equal(attemptsLabel(item(), 3), 'попыток не было');
    assert.equal(attemptsLabel(item({ attempts: 2 }), 3), 'попытка 2 из 3');
    assert.equal(attemptsLabel(item({ attempts: 1, pass: 2 }), 4), 'попытка 1 из 4 · проход 2');
  });

  it('«Отметить OK» only for брак and a FAIL waiting for its next attempt', () => {
    assert.equal(canMarkOk(item({ status: 'rejected', verdict: 'fail' })), true);
    assert.equal(canMarkOk(item({ status: 'pending', verdict: 'fail', attempts: 1 })), true);
    assert.equal(canMarkOk(item()), false);
    assert.equal(canMarkOk(item({ status: 'running' })), false);
    assert.equal(canMarkOk(item({ status: 'ok' })), false);
  });

  it('buttons follow the server rules: pause/resume/stop by status, «ещё проход» while there is брак and the queue is not stopped, delete when not running', () => {
    assert.deepEqual(queueActions(queue()), ['pause', 'stop', 'retry']);
    assert.deepEqual(queueActions(queue({ status: 'paused' })), ['resume', 'stop', 'retry', 'delete']);
    assert.deepEqual(queueActions(queue({ status: 'done', counts: { ...counts, rejected: 0 } })), ['delete']);
    assert.deepEqual(queueActions(queue({ status: 'done' })), ['retry', 'delete']);
    assert.deepEqual(queueActions(queue({ status: 'stopped' })), ['delete']);
  });
});
