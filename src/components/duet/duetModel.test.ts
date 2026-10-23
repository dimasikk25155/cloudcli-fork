import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupByMachine,
  ideasFor,
  pendingDecisions,
  pollDelayMs,
  shortName,
  sortServices,
  summarize,
  summaryLine,
  untilText,
  whenAgo,
  type DuetDecision,
  type DuetIdea,
  type DuetServiceRow,
} from './duetModel';

function row(patch: Partial<DuetServiceRow>): DuetServiceRow {
  return {
    id: patch.id ?? 'x',
    machine: 'vps-nl',
    method: 'systemd',
    target: 'x.service',
    crit: false,
    label: 'x — сервис',
    status: 'up',
    since: '2026-10-23T05:00:00Z',
    muted: false,
    project: null,
    canRestart: true,
    ideas: 0,
    ...patch,
  };
}

describe('окно Дуэта', () => {
  it('итог шапки: лежащие считаются без заглушённых', () => {
    const services = [
      row({ id: 'a', status: 'down' }),
      row({ id: 'b', status: 'down', muted: true }),
      row({ id: 'c' }),
      row({ id: 'd', status: 'idle' }),
    ];
    const summary = summarize(services);
    assert.deepEqual(summary, { total: 4, ok: 2, broken: 1, unreachable: 0, muted: 1 });
    assert.equal(summaryLine(summary), 'лежит 1 · работает 2');
    assert.equal(summaryLine(summarize([row({})])), 'Всё работает · 1 из 1');
    assert.equal(summaryLine(summarize([])), 'Ещё не проверял');
  });

  it('сломанное и критичное — наверх, заглушённое — вниз, машины по порядку', () => {
    const sorted = sortServices([
      row({ id: 'muted', status: 'down', muted: true, label: 'a' }),
      row({ id: 'ok', label: 'b' }),
      row({ id: 'down', status: 'down', label: 'c' }),
      row({ id: 'crit', status: 'down', crit: true, label: 'd' }),
    ]);
    assert.deepEqual(sorted.map((service) => service.id), ['crit', 'down', 'ok', 'muted']);
    const groups = groupByMachine([row({ id: 'w', machine: 'windows' }), row({ id: 'm', machine: 'mac' }), row({ id: 'v' })]);
    assert.deepEqual(groups.map((group) => group.title), ['Сервер NL', 'Мак', 'Windows']);
  });

  it('пока Дуэт работает — опрос чаще', () => {
    const decisions: DuetDecision[] = [];
    assert.equal(pollDelayMs({ job: null, checking: false, decisions }), 20_000);
    assert.equal(pollDelayMs({ job: { kind: 'brief', label: 'Бриф', startedAt: '' }, checking: false, decisions }), 4000);
    assert.equal(pollDelayMs(null), 4000);
  });

  it('ждут тебя — только открытые решения', () => {
    const decision = (status: DuetDecision['status']): DuetDecision => ({
      id: status, createdAt: '', source: 'watch', serviceId: 'a', title: '', body: '', options: [], status,
    });
    assert.deepEqual(pendingDecisions({ decisions: [decision('pending'), decision('done'), decision('running')] }).map((d) => d.id), ['pending']);
  });

  it('время по-человечески', () => {
    const now = new Date('2026-10-23T07:00:00Z');
    assert.equal(whenAgo('2026-10-23T06:55:00Z', now), '5 мин назад');
    assert.equal(whenAgo('2026-10-22T05:30:00Z', now), 'вчера в 08:30');
    assert.equal(untilText('2026-10-23T07:12:00Z', now), 'через 12 мин');
    assert.equal(untilText('2026-10-24T05:30:00Z', now), 'в 08:30');
    assert.equal(shortName('pulse-bot — Brand-дашборд'), 'pulse-bot');
  });

  it('идеи бота: в работе сверху, отклонённых нет', () => {
    const idea = (id: string, status: DuetIdea['status']): DuetIdea => ({
      id, serviceId: 'a', title: id, why: '', effort: 'S', status, createdAt: '2026-10-23T00:00:00Z',
    });
    const list = ideasFor([idea('done', 'done'), idea('new', 'new'), idea('gone', 'dismissed'), idea('run', 'running')], 'a');
    assert.deepEqual(list.map((entry) => entry.id), ['run', 'new', 'done']);
  });
});
