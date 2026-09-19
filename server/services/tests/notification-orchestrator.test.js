import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import webPush from 'web-push';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionsDb,
  userDb,
} from '../../modules/database/index.js';

import { buildNotificationPayload, createNotificationEvent, notifyRunStopped } from '../notification-orchestrator.js';

async function withIsolatedDatabase(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('push payload uses the app session id when notified with a provider session id', async () => {
  const originalSendNotification = webPush.sendNotification;
  const sentPayloads = [];

  webPush.sendNotification = async (_subscription, payload) => {
    sentPayloads.push(JSON.parse(payload));
    return {};
  };

  try {
    await withIsolatedDatabase(async () => {
      const user = userDb.createUser('notify-user', 'hash');
      const userId = Number(user.id);

      notificationPreferencesDb.updatePreferences(userId, {
        channels: { webPush: true },
        events: { actionRequired: true, stop: true, error: true },
      });
      pushSubscriptionsDb.saveSubscription(userId, 'https://example.test/push', 'p256dh', 'auth');
      sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
      sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

      notifyRunStopped({
        userId,
        provider: 'claude',
        sessionId: 'claude-native-1',
        stopReason: 'completed',
      });

      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(sentPayloads.length, 1);
      assert.equal(sentPayloads[0]?.data?.sessionId, 'app-session-1');
      assert.match(sentPayloads[0]?.data?.tag, /app-session-1/);
    });
  } finally {
    webPush.sendNotification = originalSendNotification;
  }
});

test('consigliere.task payload is sticky with a Done action', () => {
  const payload = buildNotificationPayload(createNotificationEvent({
    provider: 'system',
    kind: 'action_required',
    code: 'consigliere.task',
    meta: {
      row: 4,
      title: 'Оплатить свет',
      kind: 'due',
      when: '02.09 в 12:00',
      tag: 'consigliere:event:4',
      sig: 'abc',
    },
  }));
  assert.equal(payload.title, 'Канцелярия');
  assert.match(payload.body, /Оплатить свет/);
  assert.equal(payload.actions?.[0]?.action, 'done');
  assert.equal(payload.data.tag, 'consigliere:event:4');
  assert.equal(payload.data.row, 4);
  assert.equal(payload.data.sig, 'abc');
  assert.equal(payload.data.panel, 'consigliere');
  assert.equal(payload.data.urlPath, '/?panel=consigliere');
});

test('bot.dead payload opens the Server panel and close payload has no body', () => {
  const dead = buildNotificationPayload(createNotificationEvent({
    provider: 'system',
    kind: 'error',
    code: 'bot.dead',
    meta: { unit: 'tyres-bot.service', name: 'tyres-bot', tag: 'bot:tyres-bot.service' },
  }));
  assert.equal(dead.title, 'Бот упал');
  assert.equal(dead.data.panel, 'server');
  assert.equal(dead.data.tag, 'bot:tyres-bot.service');

  const closed = buildNotificationPayload(createNotificationEvent({
    provider: 'system',
    kind: 'info',
    code: 'notification.close',
    meta: { tag: 'bot:tyres-bot.service' },
  }));
  assert.equal(closed.close, true);
  assert.equal(closed.data.tag, 'bot:tyres-bot.service');
});
