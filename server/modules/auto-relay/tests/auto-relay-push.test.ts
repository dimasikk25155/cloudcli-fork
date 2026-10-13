import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  registerDesktopNotificationClient,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
import { notifyRunStopped } from '@/modules/notifications/services/notification-orchestrator.service.js';
import { beginServiceTurn } from '@/shared/service-turns.js';

// «Run stopped» is muted only for the auto-relay's own handoff turn; Dima's
// turn in the same chat pushes as usual, also while the move is under way.

test('the handoff turn is quiet, a person\'s turn in the same chat is not', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'auto-relay-push-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const received: Array<{ payload: { data: { code: string; sessionId: string | null } } }> = [];
  const device = { readyState: 1, OPEN: 1, send: (raw: string) => received.push(JSON.parse(raw)), close: () => {} };
  try {
    const userId = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    notificationPreferencesDb.updatePreferences(userId, { channels: { desktop: true }, events: { actionRequired: true, stop: true, error: true } });
    registerDesktopNotificationClient({ userId, deviceId: 'phone-1', ws: device as never });
    sessionsDb.createAppSession('chat-a', 'claude', '/workspace/a');
    sessionsDb.createAppSession('chat-b', 'claude', '/workspace/a');

    const endHandoff = beginServiceTurn('chat-a');
    notifyRunStopped({ userId, provider: 'claude', sessionId: 'chat-a', stopReason: 'completed' });
    assert.equal(received.length, 0, 'the handoff turn itself');

    // Meanwhile Dima's own turn in another chat is untouched.
    notifyRunStopped({ userId, provider: 'claude', sessionId: 'chat-b', stopReason: 'completed' });
    assert.equal(received.length, 1);
    assert.equal(received[0].payload.data.sessionId, 'chat-b');

    // The handoff turn is over; Dima writes into the same chat and his turn pushes.
    endHandoff();
    notifyRunStopped({ userId, provider: 'claude', sessionId: 'chat-a', stopReason: 'completed' });
    assert.equal(received.length, 2);
    assert.deepEqual(
      { code: received[1].payload.data.code, sessionId: received[1].payload.data.sessionId },
      { code: 'run.stopped', sessionId: 'chat-a' },
    );
  } finally {
    unregisterDesktopNotificationClient(device as never);
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
