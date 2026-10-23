import assert from 'node:assert/strict';
import test from 'node:test';

import type { Exec } from '@/modules/duet/duet-fleet.js';
import { briefInstant, createDuetService, type DuetAgentRun, type DuetNotice } from '@/modules/duet/duet.service.js';
import type { DuetDecision, DuetState } from '@/modules/duet/duet.types.js';

const REGISTRY = [
  '  - { machine: vps-nl, method: systemd, target: pulse-bot.service, crit: crit, label: "pulse-bot — бот" }',
  '  - { machine: vps-nl, method: systemd, target: jobs.service, crit: opt, label: "jobs — дашборд" }',
].join('\n');

const HOME = '/p/Antigravity Project';
const PROJECTS = [HOME, `${HOME}/pulse-bot`];

function harness(options: { usage?: string | null; agentText?: (run: DuetAgentRun) => string } = {}) {
  const fleet: Record<string, string> = { 'pulse-bot.service': 'active', 'jobs.service': 'active' };
  const calls: string[] = [];
  const notices: DuetNotice[] = [];
  const closed: DuetDecision[] = [];
  const runs: DuetAgentRun[] = [];
  let saved: DuetState | null = null;
  let clock = new Date('2026-10-23T07:00:00Z'); // 10:00 МСК

  const exec: Exec = async (command, args) => {
    const remote = args[args.length - 1] ?? '';
    calls.push(`${command} ${remote}`);
    if (remote.startsWith('systemctl is-active')) {
      const units = remote.replace('systemctl is-active ', '').split(' ');
      return { code: 0, stdout: units.map((unit) => fleet[unit] ?? 'inactive').join('\n') };
    }
    if (remote.startsWith('systemctl restart')) {
      fleet['pulse-bot.service'] = 'active';
      return { code: 0, stdout: '' };
    }
    return { code: 0, stdout: 'журнал: Main process exited' };
  };

  const service = createDuetService({
    load: async () => saved,
    save: async (state) => {
      saved = JSON.parse(JSON.stringify(state));
    },
    readRegistry: async () => REGISTRY,
    exec,
    heartbeats: async () => [],
    runAgent: async (run) => {
      runs.push(run);
      return { text: options.agentText?.(run) ?? 'ИТОГ: ГОТОВО — починил', sessionId: `s${runs.length}` };
    },
    usageBlocked: async () => options.usage ?? null,
    notify: async (notice) => {
      notices.push(notice);
      return notice.buttons ? { chatId: '42', messageId: notices.length } : null;
    },
    closeTelegram: async (decision) => {
      closed.push(decision);
    },
    projects: () => PROJECTS,
    homeProject: () => HOME,
    now: () => clock,
    settleMs: 0,
  });

  return {
    service,
    fleet,
    calls,
    notices,
    closed,
    runs,
    saved: () => saved,
    setNow: (iso: string) => {
      clock = new Date(iso);
    },
  };
}

test('падение → решение с кнопками; кнопка Telegram перезапускает; второй раз — «уже решено»', async () => {
  const h = harness();
  await h.service.check();
  assert.equal(h.notices.length, 0, 'первая проверка молчит');

  h.fleet['pulse-bot.service'] = 'failed';
  h.setNow('2026-10-23T07:15:00Z');
  await h.service.check();
  const alert = h.notices.find((notice) => notice.kind === 'down');
  assert.ok(alert, 'тревога ушла');
  assert.equal(alert.push, true);
  assert.deepEqual(alert.buttons?.map((button) => button.choice), ['restart', 'fix', 'mute']);

  const restartToken = alert.buttons![0].token;
  const result = await h.service.redeem(restartToken);
  assert.equal(result.ok, true);
  await h.service.idle();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(h.calls.includes('ssh systemctl restart pulse-bot.service 2>&1'));
  const view = await h.service.view();
  const decision = view.decisions[0];
  assert.equal(decision.status, 'done');
  assert.equal(decision.via, 'telegram');
  assert.ok(h.closed.some((entry) => entry.id === decision.id), 'сообщение в Telegram закрыто итогом');
  assert.equal(JSON.stringify(view).includes(restartToken), false, 'сырой токен не уходит в панель');

  const again = await h.service.redeem(restartToken);
  assert.deepEqual(again, { ok: false, reason: 'already_decided', label: 'Перезапустить' });
});

test('встал сам → открытое решение снимается; заглушённый не тревожит', async () => {
  const h = harness();
  await h.service.check();
  h.fleet['jobs.service'] = 'failed';
  await h.service.check();
  let view = await h.service.view();
  assert.equal(view.decisions[0].status, 'pending');

  h.fleet['jobs.service'] = 'active';
  await h.service.check();
  view = await h.service.view();
  assert.equal(view.decisions[0].status, 'expired');
  assert.equal(view.decisions[0].result, 'Поднялся сам');

  const jobsId = view.services.find((entry) => entry.target === 'jobs.service')!.id;
  await h.service.updateSettings({ mute: jobsId });
  h.fleet['jobs.service'] = 'failed';
  const before = h.notices.length;
  await h.service.check();
  assert.equal(h.notices.length, before, 'заглушённый сервис молчит');
});

test('ночью некритичное падение не будит', async () => {
  const h = harness();
  h.setNow('2026-10-23T22:00:00Z'); // 01:00 МСК
  await h.service.check();
  h.fleet['jobs.service'] = 'failed';
  await h.service.check();
  const alert = h.notices.find((notice) => notice.kind === 'down');
  assert.ok(alert);
  assert.equal(alert.push, false);
  assert.equal(alert.telegram, false);
});

test('бриф: прогон только на чтение в корне, предложение → решение с советом первым', async () => {
  const h = harness({
    agentText: () => JSON.stringify({ brief: 'pulse-bot выключен намеренно', proposals: [] }),
  });
  await h.service.check();
  h.fleet['pulse-bot.service'] = 'inactive';
  await h.service.check();
  // Решение от сторожа уже есть — бриф не дублирует его.
  const pulseId = (await h.service.view()).services.find((entry) => entry.target === 'pulse-bot.service')!.id;
  h.service.requestBrief('manual');
  await h.service.idle();
  const run = h.runs.find((entry) => entry.readOnly);
  assert.ok(run);
  assert.equal(run.projectPath, HOME);
  assert.match(run.prompt, new RegExp(`\\[${pulseId}\\]`));
  const view = await h.service.view();
  assert.equal(view.briefs[0].text, 'pulse-bot выключен намеренно');
  assert.equal(view.decisions.filter((decision) => decision.serviceId === pulseId).length, 1);
});

test('бриф предлагает «не следить» по сервису без решения → кнопка «Не следить» первой', async () => {
  const h = harness();
  await h.service.check();
  const pulseId = (await h.service.view()).services.find((entry) => entry.target === 'pulse-bot.service')!.id;
  h.fleet['pulse-bot.service'] = 'inactive';
  await h.service.check();
  const pending = (await h.service.view()).decisions[0];
  await h.service.decide(pending.id, 'dismiss', 'ui');

  const h2 = harness({
    agentText: () => JSON.stringify({ brief: 'ок', proposals: [{ serviceId: pulseId, choice: 'mute', why: 'disabled давно' }] }),
  });
  await h2.service.check();
  h2.fleet['pulse-bot.service'] = 'inactive';
  h2.setNow('2026-10-23T22:00:00Z'); // ночь: сторож решение откроет, но молча
  await h2.service.check();
  const watchDecision = (await h2.service.view()).decisions[0];
  await h2.service.decide(watchDecision.id, 'dismiss', 'ui');
  h2.service.requestBrief('manual');
  await h2.service.idle();
  const fromBrief = (await h2.service.view()).decisions.find((decision) => decision.source === 'brief');
  assert.ok(fromBrief);
  assert.equal(fromBrief.options[0].choice, 'mute');
  assert.equal(fromBrief.body, 'disabled давно');

  await h2.service.decide(fromBrief.id, 'mute', 'ui');
  assert.ok((await h2.service.view()).settings.muted.includes(pulseId));
});

test('«Починить агентом»: полный прогон в папке бота, итог в решении и в уведомлении', async () => {
  const h = harness({ agentText: () => 'ИТОГ: НЕ ВЫШЛО — нужен новый токен бота\nДима, перевыпусти токен.' });
  await h.service.check();
  h.fleet['pulse-bot.service'] = 'failed';
  await h.service.check();
  const decision = (await h.service.view()).decisions[0];
  const result = await h.service.decide(decision.id, 'fix', 'ui');
  assert.equal(result.ok, true);
  await h.service.idle();
  const run = h.runs.at(-1)!;
  assert.equal(run.readOnly, false);
  assert.equal(run.projectPath, `${HOME}/pulse-bot`);
  const done = (await h.service.view()).decisions[0];
  assert.equal(done.status, 'failed');
  assert.equal(done.result, 'НЕ ВЫШЛО — нужен новый токен бота');
  // Критичное падение сначала запускает разбор аварии (бриф), потом — починку.
  assert.equal(done.sessionId, `s${h.runs.length}`);
  assert.ok(h.notices.some((notice) => notice.kind === 'failed' && notice.push));
});

test('расписание: утренний бриф один раз в окне; лимит придерживает его, ручной — нет', async () => {
  const h = harness({ usage: 'лимит подписки 95%', agentText: () => JSON.stringify({ brief: 'утро', proposals: [] }) });
  h.setNow('2026-10-23T05:00:00Z'); // 08:00 МСК — до брифа
  await h.service.tick();
  await h.service.idle();
  assert.equal(h.runs.length, 0);

  h.setNow('2026-10-23T05:31:00Z'); // 08:31 МСК
  await h.service.tick();
  await h.service.idle();
  assert.equal(h.runs.length, 0, 'лимит — бриф отложен');
  assert.ok((await h.service.view()).events.some((event) => event.kind === 'skip'));

  h.service.requestBrief('manual');
  await h.service.idle();
  assert.equal(h.runs.length, 1, 'ручной бриф идёт и при лимите');
});

test('расписание: бриф в 08:30 и обход идей по боту с папкой', async () => {
  const h = harness({
    agentText: (run) => run.prompt.includes('предложи, как сделать его лучше')
      ? JSON.stringify({ ideas: [{ title: 'Сам вставать после сбоя', why: 'Restart=always в юните', effort: 'S' }] })
      : JSON.stringify({ brief: 'утро', proposals: [] }),
  });
  h.setNow('2026-10-23T07:31:00Z'); // 10:31 МСК
  await h.service.tick();
  await h.service.idle();
  await h.service.tick();
  await h.service.idle();
  const view = await h.service.view();
  assert.equal(view.briefs.length, 1);
  assert.equal(view.briefs[0].kind, 'morning');
  assert.equal(view.ideas.length, 1);
  assert.equal(view.ideas[0].title, 'Сам вставать после сбоя');
  const ideasRun = h.runs.find((run) => run.prompt.includes('как сделать его лучше'))!;
  assert.equal(ideasRun.readOnly, true);
  assert.equal(ideasRun.projectPath, `${HOME}/pulse-bot`);

  await h.service.tick();
  await h.service.idle();
  assert.equal(h.runs.length, 2, 'повторно ни бриф, ни обход не запускаются');

  const taken = await h.service.takeIdea(view.ideas[0].id);
  assert.ok(taken);
  await h.service.idle();
  const ideaRun = h.runs.at(-1)!;
  assert.equal(ideaRun.readOnly, false);
  assert.match(ideaRun.prompt, /Сам вставать после сбоя/);
  assert.equal((await h.service.view()).ideas[0].status, 'done');
});

test('briefInstant: 08:30 МСК = 05:30 UTC того же московского дня', () => {
  assert.equal(briefInstant(new Date('2026-10-23T22:30:00Z'), '08:30').toISOString(), '2026-10-24T05:30:00.000Z');
  assert.equal(briefInstant(new Date('2026-10-23T10:00:00Z'), '08:30').toISOString(), '2026-10-23T05:30:00.000Z');
});

test('перезапуск Neo3 посреди починки: работа отмечается сорванной', async () => {
  const state = {
    version: 1,
    settings: { briefTime: '08:30', checkEveryMin: 15, ideasEveryDays: 7, muted: [], projects: {} },
    snapshot: null,
    lastBriefAt: null,
    lastIncidentBriefAt: null,
    lastIdeasAt: null,
    briefs: [],
    events: [],
    decisions: [{ id: 'd1', createdAt: '2026-10-23T07:00:00Z', source: 'watch', serviceId: 'x', title: 't', body: '', options: [], status: 'running' }],
    ideas: [],
  } as unknown as DuetState;
  const service = createDuetService({
    load: async () => state,
    save: async () => undefined,
    readRegistry: async () => '',
    exec: async () => ({ code: 0, stdout: '' }),
    heartbeats: async () => [],
    runAgent: async () => ({ text: '', sessionId: null }),
    usageBlocked: async () => null,
    notify: async () => null,
    closeTelegram: async () => undefined,
    projects: () => [],
    homeProject: () => HOME,
  });
  const view = await service.view();
  assert.equal(view.decisions[0].status, 'failed');
});
