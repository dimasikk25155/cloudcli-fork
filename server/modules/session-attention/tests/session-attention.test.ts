import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import {
  registerGrokQuestion,
  resetGrokQuestionsForTests,
  takeGrokQuestion,
} from '@/shared/grok-question.js';
import {
  createSessionAttentionService,
  type SessionAttentionDependencies,
} from '@/modules/session-attention/session-attention.service.js';

type Fixture = {
  adminId: number;
  sessionId: string;
  projectId: string;
};

async function withIsolatedDatabase(runTest: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-attention-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const admin = userDb.createUserWithRole('dima', 'x', 'admin');
    const sessionId = sessionsDb.createSession('sess-alpha', 'claude', '/workspace/alpha', 'Хаб статусов');
    const projectId = projectsDb.getProjectPath('/workspace/alpha')!.project_id;
    await runTest({ adminId: Number(admin.id), sessionId, projectId });
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

function quietService(overrides: SessionAttentionDependencies = {}) {
  return createSessionAttentionService({
    broadcast: () => {},
    fetchLastAssistantText: async () => null,
    ...overrides,
  });
}

test('status written by one service instance is read back by a fresh instance', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const first = quietService();
    first.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });

    const restarted = quietService();
    const items = restarted.listForUser({ id: adminId, role: 'admin' });

    assert.equal(items.length, 1);
    assert.equal(items[0].sessionId, sessionId);
    assert.equal(items[0].state, 'working');
    assert.equal(items[0].projectId, projectId);
    assert.equal(items[0].projectName, 'alpha');
    assert.equal(items[0].title, 'Хаб статусов');
  });
});

test('reconcileOnBoot turns a leftover working session into failed/interrupted', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    quietService().recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });

    const afterRestart = quietService();
    const reconciled = afterRestart.reconcileOnBoot();

    const [item] = afterRestart.listForUser({ id: adminId, role: 'admin' });
    assert.equal(reconciled, 1);
    assert.equal(item.state, 'failed');
    assert.equal(item.reason, 'interrupted');
  });
});

test('AskUserQuestion puts the session into waiting/ask with every question kept whole', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const run = { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId };
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });

    service.recordRunEvent(run, {
      kind: 'permission_request',
      requestId: 'req-1',
      toolName: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: 'Какой цвет кнопки?',
            header: 'Цвет',
            options: [{ label: 'Синий', description: 'как сейчас' }, { label: 'Зелёный' }],
            multiSelect: false,
          },
          { question: 'Что добавить?', options: [{ label: 'Микрофон' }, { label: 'Чипы' }], multiSelect: true },
        ],
      },
    });

    const [item] = service.listForUser({ id: adminId, role: 'admin' });
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'ask');
    assert.deepEqual(item.detail, {
      requestId: 'req-1',
      toolName: 'AskUserQuestion',
      question: 'Какой цвет кнопки?',
      options: ['Синий', 'Зелёный'],
      questions: [
        {
          question: 'Какой цвет кнопки?',
          header: 'Цвет',
          options: [{ label: 'Синий', description: 'как сейчас' }, { label: 'Зелёный' }],
          multiSelect: false,
        },
        { question: 'Что добавить?', options: [{ label: 'Микрофон' }, { label: 'Чипы' }], multiSelect: true },
      ],
    });

    service.recordRunEvent(run, { kind: 'permission_cancelled', requestId: 'req-1' });
    assert.equal(service.listForUser({ id: adminId, role: 'admin' })[0].state, 'working');
  });
});

test('plan approval and tool permission map to waiting/plan and waiting/permission; an answer returns to working', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const run = { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId };
    const admin = { id: adminId, role: 'admin' };
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });

    service.recordRunEvent(run, {
      kind: 'permission_request',
      requestId: 'plan-1',
      toolName: 'ExitPlanMode',
      input: { plan: '## Сделать хаб\n1. Таблица статусов' },
    });
    let [item] = service.listForUser(admin);
    assert.equal(item.reason, 'plan');
    assert.equal(item.detail?.requestId, 'plan-1');
    assert.equal(item.detail?.question, 'Сделать хаб');

    service.recordAnswer('plan-1');
    assert.equal(service.listForUser(admin)[0].state, 'working');

    service.recordRunEvent(run, {
      kind: 'permission_request',
      requestId: 'perm-1',
      toolName: 'Bash',
      input: { command: 'npm test' },
    });
    [item] = service.listForUser(admin);
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'permission');
    assert.equal(item.detail?.requestId, 'perm-1');
    assert.equal(item.detail?.question, 'Bash: npm test');

    service.recordAnswer('perm-1');
    assert.equal(service.listForUser(admin)[0].state, 'working');
  });
});

test('a crashed run is failed with a short error; Stop is done and already seen by whoever pressed it', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const run = { appSessionId: sessionId, provider: 'codex', userId: adminId, projectId };
    const admin = { id: adminId, role: 'admin' };
    const otherAdminId = Number(userDb.createUserWithRole('slavik', 'x', 'admin').id);

    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    service.recordRunEvent(run, { kind: 'error', content: `Codex упал: ${'очень длинная причина '.repeat(30)}` });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 1, aborted: false });

    let [item] = service.listForUser(admin);
    assert.equal(item.state, 'failed');
    assert.equal(item.reason, 'error');
    assert.ok(item.detail?.error?.startsWith('Codex упал:'));
    assert.ok((item.detail?.error?.length ?? 0) <= 200);
    assert.equal(item.unread, true);

    // The run belongs to Dima, but Slavik pressed Stop: seen for Slavik only.
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    service.recordStopActor(sessionId, otherAdminId);
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: true });

    [item] = service.listForUser({ id: otherAdminId, role: 'admin' });
    assert.equal(item.state, 'done');
    assert.equal(item.reason, null);
    assert.equal(item.unread, false);
    assert.equal(service.listForUser(admin)[0].unread, true);

    // Stop with an unknown actor marks nobody.
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    service.recordStopActor(sessionId, null);
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: true });

    assert.equal(service.listForUser(admin)[0].unread, true);
    assert.equal(service.listForUser({ id: otherAdminId, role: 'admin' })[0].unread, true);
  });
});

test('a finished turn is classified from its last assistant text: manual ask, text question, or done', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const run = { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId };
    const admin = { id: adminId, role: 'admin' };
    const finishTurn = (events: Array<Record<string, unknown>>) => {
      service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
      for (const event of events) {
        service.recordRunEvent(run, event as { kind: string });
      }
      service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });
      return service.listForUser(admin)[0];
    };

    let item = finishTurn([
      { kind: 'text', role: 'assistant', content: 'Сначала посмотрю логи.' },
      { kind: 'tool_use', toolName: 'Bash' },
      { kind: 'stream_delta', content: 'Сборка готова.\n\nОткрой ' },
      { kind: 'stream_delta', content: 'http://localhost:3006 и пришли скриншот.' },
      { kind: 'stream_end' },
    ]);
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'manual_ask');
    assert.equal(item.detail?.excerpt, 'Открой http://localhost:3006 и пришли скриншот.');

    item = finishTurn([{ kind: 'text', role: 'assistant', content: 'Тесты зелёные.\n\nВыкатываю на прод?' }]);
    assert.equal(item.reason, 'text_question');
    assert.equal(item.detail?.question, 'Выкатываю на прод?');

    item = finishTurn([{ kind: 'text', role: 'assistant', content: 'Готово. Коммит bbb46ad8.' }]);
    assert.equal(item.state, 'done');
    assert.equal(item.reason, null);
    assert.equal(item.unread, true);
  });
});

test('when the run streamed no text, the transcript tail decides the ending', async () => {
  await withIsolatedDatabase(async ({ adminId, sessionId, projectId }) => {
    const asked: string[] = [];
    const service = quietService({
      fetchLastAssistantText: async (id) => {
        asked.push(id);
        return 'Проверь у себя на телефоне, пропала ли точка.';
      },
    });
    const run = { appSessionId: sessionId, provider: 'codex', userId: adminId, projectId };
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });

    await new Promise((resolve) => setImmediate(resolve));

    const [item] = service.listForUser({ id: adminId, role: 'admin' });
    assert.deepEqual(asked, [sessionId]);
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'manual_ask');
  });
});

test('Grok: question asked, CLI killed, complete — stays waiting while the question is pending in Grok storage', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    resetGrokQuestionsForTests();
    const service = quietService();
    const run = { appSessionId: sessionId, provider: 'grok', userId: adminId, projectId };
    const admin = { id: adminId, role: 'admin' };
    const input = { questions: [{ question: 'Куда деплоим?', options: [{ label: 'VPS' }, { label: 'Мак' }] }] };

    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'grok', projectId });
    registerGrokQuestion({ requestId: 'grok-q1', appSessionId: sessionId, input });
    service.recordRunEvent(run, { kind: 'permission_request', requestId: 'grok-q1', toolName: 'AskUserQuestion', input });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });

    let [item] = service.listForUser(admin);
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'ask');
    assert.equal(item.detail?.requestId, 'grok-q1');

    // Same flow, but the question was already taken from the store (answered
    // by typing) before the run completed: the text classifier decides.
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'grok', projectId });
    registerGrokQuestion({ requestId: 'grok-q2', appSessionId: sessionId, input });
    service.recordRunEvent(run, { kind: 'permission_request', requestId: 'grok-q2', toolName: 'AskUserQuestion', input });
    takeGrokQuestion('grok-q2');
    service.recordRunEvent(run, { kind: 'text', role: 'assistant', content: 'Задеплоил на VPS.' });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });

    [item] = service.listForUser(admin);
    assert.equal(item.state, 'done');
    resetGrokQuestionsForTests();
  });
});

test('listForUser shows an employee only granted projects; seen marks are per user and never clear waiting', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const employeeId = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const betaSessionId = sessionsDb.createSession('sess-beta', 'grok', '/workspace/beta', 'Бета');
    const betaProjectId = projectsDb.getProjectPath('/workspace/beta')!.project_id;
    const gammaSessionId = sessionsDb.createSession('sess-gamma', 'codex', '/workspace/beta', 'Гамма');
    userProjectAccessDb.grantAccess(employeeId, betaProjectId, adminId);

    const finishDone = (id: string, provider: string, project: string) => {
      service.recordRunStart({ appSessionId: id, userId: adminId, provider, projectId: project });
      service.recordRunEvent({ appSessionId: id, provider, userId: adminId, projectId: project },
        { kind: 'text', role: 'assistant', content: 'Готово.' });
      service.recordRunEvent({ appSessionId: id, provider, userId: adminId, projectId: project },
        { kind: 'complete', exitCode: 0, aborted: false });
    };
    finishDone(sessionId, 'claude', projectId);
    finishDone(betaSessionId, 'grok', betaProjectId);
    service.recordRunStart({ appSessionId: gammaSessionId, userId: adminId, provider: 'codex', projectId: betaProjectId });
    service.recordRunEvent({ appSessionId: gammaSessionId, provider: 'codex', userId: adminId, projectId: betaProjectId },
      { kind: 'text', role: 'assistant', content: 'Какой вариант берём?' });
    service.recordRunEvent({ appSessionId: gammaSessionId, provider: 'codex', userId: adminId, projectId: betaProjectId },
      { kind: 'complete', exitCode: 0, aborted: false });

    const employee = { id: employeeId, role: 'user' };
    const admin = { id: adminId, role: 'admin' };

    assert.deepEqual(service.listForUser(employee).map((item) => item.sessionId).sort(), [betaSessionId, gammaSessionId].sort());
    assert.equal(service.listForUser(admin).length, 3);

    // An employee cannot mark a session of a project they were not granted.
    assert.deepEqual(service.markSeen(employee, { sessionIds: [sessionId] }), { marked: 0 });

    service.markSeen(employee, { all: true });
    const employeeView = new Map(service.listForUser(employee).map((item) => [item.sessionId, item]));
    assert.equal(employeeView.get(betaSessionId)?.unread, false);
    assert.equal(employeeView.get(gammaSessionId)?.state, 'waiting');
    assert.deepEqual(service.countsFor([...employeeView.values()]), { waiting: 1, failed: 0, unreadDone: 0, working: 0 });

    // The admin's own view is untouched by the employee's "всё просмотрено".
    const adminView = new Map(service.listForUser(admin).map((item) => [item.sessionId, item]));
    assert.equal(adminView.get(betaSessionId)?.unread, true);
    assert.deepEqual(service.countsFor([...adminView.values()]), { waiting: 1, failed: 0, unreadDone: 2, working: 0 });

    service.markSeen(admin, { sessionIds: [sessionId] });
    assert.equal(service.listForUser(admin).find((item) => item.sessionId === sessionId)?.unread, false);
    assert.equal(service.listForUser(admin).find((item) => item.sessionId === betaSessionId)?.unread, true);
  });
});

test('every transition reaches onChange listeners and broadcasts a content-free attention_changed frame', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const frames: Array<Record<string, unknown>> = [];
    const service = quietService({ broadcast: (payload) => frames.push(payload) });
    const changes: Array<{ state: string; reason: string | null; previous: unknown; requestId?: string }> = [];
    const unsubscribe = service.onChange((change) => {
      changes.push({ state: change.state, reason: change.reason, previous: change.previous, requestId: change.detail?.requestId });
    });
    const run = { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId };

    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
    service.recordRunEvent(run, { kind: 'permission_request', requestId: 'r-9', toolName: 'Write', input: { file_path: '/tmp/a' } });
    service.recordRunEvent(run, { kind: 'text', role: 'assistant', content: 'Записал.' });
    service.recordAnswer('r-9');
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });

    assert.deepEqual(changes, [
      { state: 'working', reason: null, previous: null, requestId: undefined },
      { state: 'waiting', reason: 'permission', previous: { state: 'working', reason: null, requestId: null }, requestId: 'r-9' },
      { state: 'working', reason: null, previous: { state: 'waiting', reason: 'permission', requestId: 'r-9' }, requestId: undefined },
      { state: 'done', reason: null, previous: { state: 'working', reason: null, requestId: null }, requestId: undefined },
    ]);
    assert.equal(frames.length, 4);
    for (const frame of frames) {
      assert.deepEqual(Object.keys(frame).sort(), ['kind', 'sessionId', 'timestamp']);
      assert.equal(frame.kind, 'attention_changed');
      assert.equal(frame.sessionId, sessionId);
    }

    unsubscribe();
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
    assert.equal(changes.length, 4);
  });
});

test('Codex: a bare per-turn complete followed by the final complete 0 ends as done and never passes through failed', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const service = quietService();
    const states: string[] = [];
    service.onChange((change) => states.push(change.state));
    const run = { appSessionId: sessionId, provider: 'codex', userId: adminId, projectId };

    // Real order from openai-codex.js: normalized turn.completed (kind
    // 'complete' without exitCode) then the runtime's terminal complete.
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    service.recordRunEvent(run, { kind: 'text', role: 'assistant', content: 'Поправил тесты, всё зелёное.' });
    service.recordRunEvent(run, { kind: 'complete' });
    service.recordRunEvent(run, { kind: 'status', text: 'token_budget' });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, success: true, aborted: false });

    const [item] = service.listForUser({ id: adminId, role: 'admin' });
    assert.equal(item.state, 'done');
    assert.deepEqual(states, ['working', 'done']);
  });
});

test('a failing history fallback ends the turn as done without throwing', async () => {
  await withIsolatedDatabase(async ({ adminId, sessionId, projectId }) => {
    const service = quietService({
      fetchLastAssistantText: async () => {
        throw new Error('transcript unreadable');
      },
    });
    const run = { appSessionId: sessionId, provider: 'codex', userId: adminId, projectId };
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'codex', projectId });
    assert.doesNotThrow(() => service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false }));

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(service.listForUser({ id: adminId, role: 'admin' })[0].state, 'done');
  });
});

test('a history fallback that resolves after a new run started does not overwrite the new run', async () => {
  await withIsolatedDatabase(async ({ adminId, sessionId, projectId }) => {
    let release: (text: string) => void = () => {};
    const service = quietService({
      fetchLastAssistantText: () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    });
    const run = { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId };
    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
    service.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });

    service.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
    release('Выкатываю на прод?');
    await new Promise((resolve) => setImmediate(resolve));

    const [item] = service.listForUser({ id: adminId, role: 'admin' });
    assert.equal(item.state, 'working');
    assert.equal(item.reason, null);
  });
});

test('reconcileOnBoot: a Claude session left waiting on a request becomes failed/interrupted', async () => {
  await withIsolatedDatabase(({ adminId, sessionId, projectId }) => {
    const before = quietService();
    before.recordRunStart({ appSessionId: sessionId, userId: adminId, provider: 'claude', projectId });
    before.recordRunEvent(
      { appSessionId: sessionId, provider: 'claude', userId: adminId, projectId },
      { kind: 'permission_request', requestId: 'c-1', toolName: 'Bash', input: { command: 'rm -rf dist' } },
    );

    const afterRestart = quietService();
    assert.equal(afterRestart.reconcileOnBoot(), 1);

    const [item] = afterRestart.listForUser({ id: adminId, role: 'admin' });
    assert.equal(item.state, 'failed');
    assert.equal(item.reason, 'interrupted');
  });
});

test('reconcileOnBoot: a Grok question stays waiting as a text question with the question kept', async () => {
  await withIsolatedDatabase(({ adminId }) => {
    const grokSessionId = sessionsDb.createSession('sess-grok', 'grok', '/workspace/grok', 'Grok');
    const grokProjectId = projectsDb.getProjectPath('/workspace/grok')!.project_id;
    const input = { questions: [{ question: 'Куда деплоим?', options: [{ label: 'VPS' }, { label: 'Мак' }] }] };
    resetGrokQuestionsForTests();
    const before = quietService();
    const run = { appSessionId: grokSessionId, provider: 'grok', userId: adminId, projectId: grokProjectId };
    before.recordRunStart({ appSessionId: grokSessionId, userId: adminId, provider: 'grok', projectId: grokProjectId });
    registerGrokQuestion({ requestId: 'g-1', appSessionId: grokSessionId, input });
    before.recordRunEvent(run, { kind: 'permission_request', requestId: 'g-1', toolName: 'AskUserQuestion', input });
    before.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });
    resetGrokQuestionsForTests();

    const afterRestart = quietService();
    assert.equal(afterRestart.reconcileOnBoot(), 1);

    const [item] = afterRestart.listForUser({ id: adminId, role: 'admin' });
    assert.equal(item.state, 'waiting');
    assert.equal(item.reason, 'text_question');
    assert.equal(item.detail?.question, 'Куда деплоим?');
    assert.equal(item.detail?.requestId, undefined);
  });
});
