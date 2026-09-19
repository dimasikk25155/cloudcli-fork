// @ts-nocheck
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import webPush from 'web-push';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  normalizePlanner,
  resetStickyPushStateForTests,
  syncConsigliereEvents,
  syncDeadBots,
} from '@/modules/sticky-push/sticky-push.service.js';

describe('sticky-push sync', () => {
  let tempDirectory = '';
  const sent: Array<{ title?: string; silent?: boolean; close?: boolean; data?: { tag?: string } }> = [];
  let originalSend: typeof webPush.sendNotification;
  const previousEnv = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    STICKY_PUSH_STATE: process.env.STICKY_PUSH_STATE,
    STICKY_PUSH_POLICY: process.env.STICKY_PUSH_POLICY,
  };

  before(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sticky-push-'));
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    process.env.STICKY_PUSH_STATE = path.join(tempDirectory, 'state.json');
    process.env.STICKY_PUSH_POLICY = path.join(tempDirectory, 'missing-policy.json');
    closeConnection();
    await initializeDatabase();
    const user = userDb.createUserWithRole('owner', 'hash', 'admin');
    const userId = Number(user.id);
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { webPush: true },
      events: { actionRequired: true, stop: true, error: true },
    });
    pushSubscriptionsDb.saveSubscription(userId, 'https://example.test/push', 'p256dh', 'auth');
    originalSend = webPush.sendNotification;
    webPush.sendNotification = async (_subscription, payload) => {
      sent.push(JSON.parse(String(payload)));
      return {};
    };
  });

  after(async () => {
    webPush.sendNotification = originalSend;
    closeConnection();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('первый раз орёт, повтор без звука, снятие закрывает тег', async () => {
    sent.length = 0;
    await resetStickyPushStateForTests();
    const event = { row: 7, title: 'Свет', date: '2026-09-02', time: '12:00', kind: 'due' as const };

    const first = await syncConsigliereEvents([event], Date.parse('2026-09-02T12:00:00+03:00'));
    assert.deepEqual(first.sent, ['loud:7']);
    assert.equal(sent[0]?.title, 'Канцелярия');
    assert.equal(sent[0]?.silent, false);

    const second = await syncConsigliereEvents([event], Date.parse('2026-09-02T12:10:00+03:00'));
    assert.deepEqual(second.sent, ['silent:7']);
    assert.equal(sent[1]?.silent, true);
    assert.equal(sent[1]?.data?.tag, 'consigliere:event:7');

    const third = await syncConsigliereEvents([], Date.parse('2026-09-02T12:20:00+03:00'));
    assert.deepEqual(third.closed, ['7']);
    assert.equal(sent[2]?.close, true);
    assert.equal(sent[2]?.data?.tag, 'consigliere:event:7');
  });

  it('бот: один пуш после грейса, ожил — тихий close, без «снова жив»', async () => {
    sent.length = 0;
    await resetStickyPushStateForTests();
    const t0 = Date.parse('2026-09-02T13:00:00+03:00');
    const problem = {
      key: 'svc:tyres-bot.service:failed',
      text: 'сервис <b>tyres-bot</b> упал',
      since: t0,
    };

    const tooSoon = await syncDeadBots([problem], t0 + 60_000);
    assert.deepEqual(tooSoon.sent, []);

    const afterGrace = await syncDeadBots([problem], t0 + 6 * 60_000);
    assert.deepEqual(afterGrace.sent, [problem.key]);
    assert.equal(sent[0]?.title, 'Бот упал');
    assert.equal(sent[0]?.data?.tag, 'bot:tyres-bot.service');

    const stillDead = await syncDeadBots([problem], t0 + 20 * 60_000);
    assert.deepEqual(stillDead.sent, []);

    const recovered = await syncDeadBots([], t0 + 21 * 60_000);
    assert.deepEqual(recovered.closed, [problem.key]);
    assert.equal(sent[1]?.close, true);
    assert.notEqual(sent[1]?.title, 'Бот упал');
  });

  it('planner JSON: мусор отбрасывает, пустой daysLeft не становится нулём', () => {
    const planner = normalizePlanner({
      events: [
        { row: 4, title: 'Соцзащита', date: '2026-08-30', time: '', kind: 'overdue', when: '30.08 (весь день)' },
        { row: 1, title: 'заголовок' },
        { title: 'без строки' },
      ],
      cards: [
        { row: 2, name: 'Сбер', amount: '15000', dueDate: '2026-09-10', daysLeft: null, kind: 'upcoming' },
      ],
      subs: [
        { row: 3, name: 'Proxy', day: '5', amount: '199', daysLeft: 3, kind: 'upcoming' },
      ],
    });
    assert.equal(planner.events.length, 1);
    assert.equal(planner.events[0]?.title, 'Соцзащита');
    assert.equal(planner.cards[0]?.daysLeft, null);
    assert.equal(planner.subs[0]?.daysLeft, 3);
  });

  it('пуш канцелярии идёт на телефонный аккаунт, не на первого админа без подписки', async () => {
    sent.length = 0;
    await resetStickyPushStateForTests();
    const owner = userDb.listUsers().find((user) => user.username === 'owner');
    const ownerId = Number(owner?.id);
    pushSubscriptionsDb.removeAllForUser(ownerId);

    const phone = userDb.createUserWithRole('phone', 'hash', 'admin');
    const phoneId = Number(phone.id);
    notificationPreferencesDb.updatePreferences(phoneId, {
      channels: { webPush: true },
      events: { actionRequired: true, stop: true, error: true },
    });
    pushSubscriptionsDb.saveSubscription(phoneId, 'https://example.test/phone', 'p256dh', 'auth');

    const result = await syncConsigliereEvents(
      [{ row: 9, title: 'ТЕСТ пуш Neo3', date: '2026-09-02', time: '', kind: 'due' }],
      Date.parse('2026-09-02T18:20:00+03:00'),
    );
    assert.deepEqual(result.sent, ['loud:9']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.title, 'Канцелярия');
    assert.match(String(sent[0]?.body), /ТЕСТ пуш Neo3/);
  });

  it('старый state без deliveredTo снова орёт, а не шепчет в пустоту', async () => {
    sent.length = 0;
    await resetStickyPushStateForTests({
      consigliere: { '7': { loudAt: 1, tag: 'consigliere:event:7' } },
    });
    const result = await syncConsigliereEvents(
      [{ row: 7, title: 'Соцзащита', date: '2026-09-01', time: '10:00', kind: 'overdue' }],
      Date.parse('2026-09-03T15:30:00+03:00'),
    );
    assert.deepEqual(result.sent, ['loud:7']);
    assert.equal(sent[0]?.silent, false);
    assert.match(String(sent[0]?.body), /Соцзащита/);
  });
});
