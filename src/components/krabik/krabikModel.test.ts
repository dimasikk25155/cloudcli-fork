import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { krabikSubtitle, krabikView, mergePoll, pollDelayMs, QUICK_TASKS, reportDay, reportTitle, shortWhen } from './krabikModel';

describe('окно Крабика', () => {
  it('статус → краб и подпись', () => {
    assert.equal(krabikView({ reachable: true, status: 'working' }).crab, 'running');
    assert.equal(krabikView({ reachable: true, status: 'idle' }).label, 'Свободен — дай задачу');
    const waiting = krabikView({ reachable: true, status: 'blocked' });
    assert.equal(waiting.tone, 'warning');
    assert.equal(waiting.canStop, true);
    // Herdr не видит процесса — Крабик спит, его можно разбудить.
    assert.equal(krabikView({ reachable: true, status: 'unknown' }).canWake, true);
    assert.equal(krabikView({ reachable: false, status: 'unknown' }).label, 'Нет связи с сервером');
    assert.equal(krabikView(null).label, 'Подключаюсь…');
  });

  it('пока работает — опрос чаще', () => {
    assert.equal(pollDelayMs('working'), 3000);
    assert.equal(pollDelayMs('blocked'), 3000);
    assert.equal(pollDelayMs('idle'), 15000);
    assert.equal(pollDelayMs(undefined), 15000);
  });

  it('готовые задачи — короткие подписи и непустой текст', () => {
    assert.ok(QUICK_TASKS.length >= 4);
    for (const task of QUICK_TASKS) {
      assert.ok(task.label.length <= 20, task.label);
      assert.ok(task.prompt.length > 20, task.label);
    }
  });

  it('имена отчётов по-человечески', () => {
    assert.equal(reportTitle('duty-2026-10-23.md'), 'Утреннее дежурство');
    assert.equal(reportTitle('2026-10-22-health-check.md'), 'health check');
    assert.equal(reportDay('2026-10-22-health-check.md'), '22.10');
    assert.equal(reportDay('notes.md'), '');
    assert.equal(reportTitle('2026-10-22-proverka-botov.md', 'Проверка ботов и служб'), 'Проверка ботов и служб');
  });

  it('подпись: работает — что сейчас, свободен — последняя задача', () => {
    const messages = [
      { id: '1', role: 'user' as const, text: 'Проверь\nботов', at: null },
      { id: '2', role: 'assistant' as const, text: 'Готово', at: null },
    ];
    assert.equal(krabikSubtitle({ reachable: true, status: 'working', title: 'Смотрю логи', messages }), 'Сейчас: Смотрю логи');
    assert.equal(krabikSubtitle({ reachable: true, status: 'idle', title: 'старый заголовок', messages }), 'Последняя задача: Проверь ботов');
    assert.match(krabikSubtitle({ reachable: false, status: 'unknown', title: '', messages: [] }), /VPS NL/);
    const stepping = [...messages, { id: '3', role: 'tool' as const, text: 'читает a.log\nвыполняет: Сравниваю поля', at: null }];
    assert.equal(krabikSubtitle({ reachable: true, status: 'working', title: 'старый', messages: stepping }), 'Сейчас: выполняет: Сравниваю поля');
    assert.match(krabikSubtitle({ reachable: true, status: 'blocked', title: '', messages }), /ответь/);
  });

  it('единичный сбой опроса не превращается в «нет связи»', () => {
    const good = { reachable: true, status: 'idle' as const, title: '', completionSeq: 1, messages: [] };
    const bad = { reachable: false, status: 'unknown' as const, title: '', completionSeq: 0, messages: [] };
    assert.equal(mergePoll(good, bad, 1), good);
    assert.equal(mergePoll(good, bad, 2), good);
    assert.equal(mergePoll(good, bad, 3), bad);
    assert.equal(mergePoll(null, bad, 1), bad);
  });

  it('время: сегодня — только часы', () => {
    const now = new Date('2026-10-22T12:00:00');
    assert.match(shortWhen('2026-10-22T09:05:00', now), /^09:05$/);
    assert.match(shortWhen('2026-10-21T09:05:00', now), /^21\.10 09:05$/);
    assert.equal(shortWhen(null, now), '');
    assert.equal(shortWhen('garbage', now), '');
  });
});
