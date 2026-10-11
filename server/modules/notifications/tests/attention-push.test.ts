import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  sessionAttentionDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  registerDesktopNotificationClient,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
import { createAttentionPushListener } from '@/modules/notifications/services/attention-push.service.js';
import { buildNotificationPayload, notifyRunStopped } from '@/modules/notifications/services/notification-orchestrator.service.js';
import type { AnswerChoice } from '@/modules/pending-answers/pending-answers.service.js';
import type { AttentionChange } from '@/modules/session-attention/session-attention.service.js';

async function withIsolatedDatabase(runTest: (sessionId: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'attention-push-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const sessionId = sessionsDb.createSession('sess-push', 'claude', '/workspace/alpha', 'Миграция базы');
    await runTest(sessionId);
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

type Sent = { userId: number; payload: Record<string, any> };

/** Listener over fake channels: payloads are built exactly as the service worker receives them. */
function harness() {
  const sent: Sent[] = [];
  const issued: Array<{ requestId: string; userId: number; choices: AnswerChoice[] }> = [];
  const listener = createAttentionPushListener({
    notify: ({ userId, event }) => {
      sent.push({ userId, payload: buildNotificationPayload(event) as Record<string, any> });
    },
    issueTokens: (requestId, userId, choices) => {
      issued.push({ requestId, userId: Number(userId), choices });
      return choices.map((choice) => ({ id: choice.id, label: choice.label, token: `tok-${requestId}-${choice.id}` }));
    },
  });
  return { sent, issued, listener };
}

function change(sessionId: string, partial: Partial<AttentionChange>): AttentionChange {
  return {
    sessionId,
    userId: 7,
    projectId: 'p1',
    provider: 'claude',
    state: 'working',
    reason: null,
    detail: null,
    updatedAt: '2026-10-12T10:00:00.000Z',
    previous: null,
    ...partial,
  };
}

const ASK_DETAIL = {
  requestId: 'req-ask',
  toolName: 'AskUserQuestion',
  question: 'Какую базу берём?',
  options: ['Postgres', 'SQLite', 'MySQL'],
  questions: [{
    question: 'Какую базу берём?',
    options: [{ label: 'Postgres' }, { label: 'SQLite' }, { label: 'MySQL' }],
    multiSelect: false,
  }],
};

test('one question without multiselect: one push with the first two options as buttons, closed once answered', async () => {
  await withIsolatedDatabase((sessionId) => {
    const { sent, issued, listener } = harness();
    const waiting = change(sessionId, {
      state: 'waiting',
      reason: 'ask',
      detail: ASK_DETAIL,
      previous: { state: 'working', reason: null, requestId: null },
    });

    listener(waiting);
    // The same request reported again (e.g. the next pending one settled back) is not a new push.
    listener({ ...waiting, updatedAt: '2026-10-12T10:00:05.000Z', previous: { state: 'waiting', reason: 'permission', requestId: 'req-other' } });

    assert.equal(sent.length, 1);
    const push = sent[0];
    assert.equal(push.userId, 7);
    assert.deepEqual(push.payload.actions, [
      { action: 'answer:opt1', title: 'Postgres' },
      { action: 'answer:opt2', title: 'SQLite' },
    ]);
    assert.deepEqual(push.payload.data.answers, {
      'answer:opt1': 'tok-req-ask-opt1',
      'answer:opt2': 'tok-req-ask-opt2',
    });
    assert.equal(push.payload.data.code, 'attention.waiting');
    assert.equal(push.payload.data.sessionId, sessionId);
    assert.equal(push.payload.data.tag, `attention:${sessionId}`);
    assert.equal(push.payload.requireInteraction, true);
    assert.equal(push.payload.title, 'Миграция базы');
    assert.match(push.payload.body, /Какую базу берём\?/);
    assert.match(push.payload.body, /MySQL/, 'options beyond the two buttons stay readable in the text');

    assert.equal(issued.length, 1);
    assert.equal(issued[0].requestId, 'req-ask');
    assert.equal(issued[0].userId, 7);
    assert.deepEqual(issued[0].choices[1].decision, { allow: true, answers: { 'Какую базу берём?': 'SQLite' } });

    listener(change(sessionId, {
      state: 'working',
      updatedAt: '2026-10-12T10:01:00.000Z',
      previous: { state: 'waiting', reason: 'ask', requestId: 'req-ask' },
    }));

    assert.equal(sent.length, 2);
    assert.equal(sent[1].userId, 7);
    assert.equal(sent[1].payload.close, true);
    assert.equal(sent[1].payload.data.tag, `attention:${sessionId}`);
  });
});

function firstPushFor(sessionId: string, partial: Partial<AttentionChange>) {
  const { sent, issued, listener } = harness();
  listener(change(sessionId, { state: 'waiting', previous: { state: 'working', reason: null, requestId: null }, ...partial }));
  assert.equal(sent.length, 1, 'exactly one push');
  return { payload: sent[0].payload, issued };
}

test('plan: «Одобрить» answers, «Открыть» opens', async () => {
  await withIsolatedDatabase((sessionId) => {
    const { payload, issued } = firstPushFor(sessionId, {
      provider: 'grok',
      reason: 'plan',
      detail: { requestId: 'req-plan', toolName: 'ExitPlanMode', question: 'Переезд на Postgres' },
    });
    assert.deepEqual(payload.actions, [
      { action: 'answer:approve', title: 'Одобрить' },
      { action: 'open', title: 'Открыть' },
    ]);
    assert.deepEqual(Object.keys(payload.data.answers), ['answer:approve']);
    assert.deepEqual(issued[0].choices.map((choice) => choice.decision), [{ allow: true }]);
    assert.match(payload.body, /^Grok/);
  });
});

test('permission: «Разрешить» allows, «Отклонить» denies', async () => {
  await withIsolatedDatabase((sessionId) => {
    const { payload, issued } = firstPushFor(sessionId, {
      reason: 'permission',
      detail: { requestId: 'req-perm', toolName: 'Bash', question: 'Bash: rm -rf dist' },
    });
    assert.deepEqual(payload.actions, [
      { action: 'answer:allow', title: 'Разрешить' },
      { action: 'answer:deny', title: 'Отклонить' },
    ]);
    assert.deepEqual(issued[0].choices.map((choice) => choice.decision), [{ allow: true }, { allow: false }]);
    assert.match(payload.body, /rm -rf dist/);
  });
});

test('several questions or multiselect: no answer buttons, only «Открыть», first question in the text', async () => {
  await withIsolatedDatabase((sessionId) => {
    const multi = firstPushFor(sessionId, {
      reason: 'ask',
      detail: {
        ...ASK_DETAIL,
        questions: [{ ...ASK_DETAIL.questions[0], multiSelect: true }],
      },
    });
    assert.deepEqual(multi.payload.actions, [{ action: 'open', title: 'Открыть' }]);
    assert.deepEqual(multi.payload.data.answers, {});
    assert.equal(multi.issued.length, 0);

    const several = firstPushFor(sessionId, {
      reason: 'ask',
      detail: {
        ...ASK_DETAIL,
        questions: [ASK_DETAIL.questions[0], { question: 'Где хостим?', options: [{ label: 'VPS' }], multiSelect: false }],
      },
    });
    assert.deepEqual(several.payload.actions, [{ action: 'open', title: 'Открыть' }]);
    assert.match(several.payload.body, /Какую базу берём\?/);
    assert.equal(several.issued.length, 0);
  });
});

test('Codex turn ending with a question: push with «Открыть» only, one per turn', async () => {
  await withIsolatedDatabase((sessionId) => {
    const { sent, issued, listener } = harness();
    const turnEnd = change(sessionId, {
      provider: 'codex',
      state: 'waiting',
      reason: 'text_question',
      detail: { question: 'Оставить старый API или удалить?', excerpt: 'Оставить старый API или удалить?' },
      previous: { state: 'working', reason: null, requestId: null },
    });
    listener(turnEnd);
    listener({ ...turnEnd, previous: { state: 'waiting', reason: 'text_question', requestId: null } });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].payload.actions, [{ action: 'open', title: 'Открыть' }]);
    assert.match(sent[0].payload.body, /^Codex.*Оставить старый API/);
    assert.equal(issued.length, 0);
  });
});

test('a turn that ends waiting for the user gets only the «нужен ответ» push, not a second «run stopped» one', async () => {
  await withIsolatedDatabase((sessionId) => {
    const user = userDb.createUserWithRole('dima', 'x', 'admin');
    const userId = Number(user.id);
    notificationPreferencesDb.updatePreferences(userId, { channels: { desktop: true }, events: { actionRequired: true, stop: true, error: true } });
    const received: Array<Record<string, any>> = [];
    const device = { readyState: 1, OPEN: 1, send: (raw: string) => received.push(JSON.parse(raw)), close: () => {} };
    registerDesktopNotificationClient({ userId, deviceId: 'phone-1', ws: device as never });

    try {
      const row = { session_id: sessionId, user_id: userId, project_id: null, provider: 'claude', detail_json: null, updated_at: '2026-10-12T10:00:00.000Z' };
      sessionAttentionDb.upsert({ ...row, state: 'waiting', reason: 'text_question' });
      // Engines report the provider-native id; it maps to the same app session.
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'sess-push', stopReason: 'completed' });
      assert.equal(received.length, 0);

      sessionAttentionDb.upsert({ ...row, state: 'done', reason: null, updated_at: '2026-10-12T10:05:00.000Z' });
      notifyRunStopped({ userId, provider: 'claude', sessionId: 'sess-push', stopReason: 'completed' });
      assert.equal(received.length, 1);
      assert.equal(received[0].payload.data.code, 'run.stopped');
    } finally {
      unregisterDesktopNotificationClient(device as never);
    }
  });
});

test('Grok asks a question: «нужен ответ» push to whoever started the run, with answer buttons', async () => {
  await withIsolatedDatabase((sessionId) => {
    const { sent, issued, listener } = harness();
    listener(change(sessionId, {
      provider: 'grok',
      userId: 12,
      state: 'waiting',
      reason: 'ask',
      detail: { ...ASK_DETAIL, requestId: 'req-grok' },
      previous: { state: 'working', reason: null, requestId: null },
    }));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].userId, 12);
    assert.equal(sent[0].payload.data.code, 'attention.waiting');
    assert.equal(sent[0].payload.data.provider, 'grok');
    assert.match(sent[0].payload.body, /^Grok спрашивает: Какую базу берём\?/);
    assert.deepEqual(sent[0].payload.actions.map((action: { title: string }) => action.title), ['Postgres', 'SQLite']);
    assert.equal(issued[0].requestId, 'req-grok');
    assert.equal(issued[0].userId, 12);
  });
});
