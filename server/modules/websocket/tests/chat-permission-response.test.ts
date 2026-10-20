import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { sessionAttention } from '@/modules/session-attention/session-attention.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import { peekGrokQuestion, registerGrokQuestion, resetGrokQuestionsForTests } from '@/shared/grok-question.js';

type Fixture = { adminId: number; employeeId: number; sessionId: string; projectId: string };

async function withIsolatedDatabase(runTest: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-permission-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const admin = userDb.createUserWithRole('dima', 'x', 'admin');
    const employee = userDb.createUserWithRole('slavik', 'x', 'user');
    const sessionId = sessionsDb.createSession('provider-alpha', 'claude', '/workspace/alpha', 'Чужая сессия');
    const projectId = projectsDb.getProjectPath('/workspace/alpha')!.project_id;
    await runTest({ adminId: Number(admin.id), employeeId: Number(employee.id), sessionId, projectId });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    resetGrokQuestionsForTests();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** A websocket the gateway can talk to: frames it sends are collected, messages are emitted at it. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  async deliver(payload: Record<string, unknown>): Promise<void> {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
    // The handler is async; let it run to completion.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

type SpawnCall = { command: string; options: Record<string, unknown>; writer: { send: (message: unknown) => void } };

function fakeDependencies() {
  const approvals: Array<{ requestId: string; payload: Record<string, unknown> }> = [];
  const spawns: SpawnCall[] = [];
  const dependencies = {
    // Fake project folders: the jail has its own tests (chat-user-jail.test.ts).
    userJailFor: () => null,
    spawnFns: {
      grok: async (command: string, options: Record<string, unknown>, writer: unknown) => {
        spawns.push({ command, options, writer: writer as SpawnCall['writer'] });
        // Keeps running until the test ends the run, like a real resumed CLI.
        await new Promise(() => {});
      },
    },
    abortFns: {},
    resolveToolApproval: (requestId: string, payload: Record<string, unknown>) => {
      approvals.push({ requestId, payload });
    },
    getPendingApprovalsForSession: () => [],
  } as unknown as Parameters<typeof handleChatConnection>[2];
  return { dependencies, approvals, spawns };
}

function openClaudeRequest(fixture: Fixture, requestId: string): void {
  sessionAttention.recordRunStart({ appSessionId: fixture.sessionId, userId: fixture.adminId, provider: 'claude', projectId: fixture.projectId });
  sessionAttention.recordRunEvent(
    { appSessionId: fixture.sessionId, provider: 'claude' },
    { kind: 'permission_request', requestId, toolName: 'Bash', input: { command: 'rm -rf dist' } },
  );
}

test('a permission answer over the websocket for a session of a project the user cannot access is refused', async () => {
  await withIsolatedDatabase(async (fixture) => {
    openClaudeRequest(fixture, 'req-ws-1');
    const { dependencies, approvals } = fakeDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.employeeId, role: 'user' } } as never, dependencies);

    await socket.deliver({ type: 'chat.permission-response', requestId: 'req-ws-1', allow: true });

    assert.equal(approvals.length, 0, 'the engine must not receive a stranger\'s answer');
    const denial = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.equal(denial?.code, 'PERMISSION_ACCESS_DENIED');

    userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
    await socket.deliver({ type: 'chat.permission-response', requestId: 'req-ws-1', allow: true });

    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].requestId, 'req-ws-1');
    assert.equal(approvals[0].payload.allow, true);
    const item = sessionAttention.listForUser({ id: fixture.adminId, role: 'admin' }).find((entry) => entry.sessionId === fixture.sessionId);
    assert.equal(item?.state, 'working', 'answered request no longer waits');
  });
});

test('a Grok question answered from a push resumes the session with nobody connected; opening the session shows the run', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { pendingAnswers } = await import('@/modules/pending-answers/pending-answers.service.js');
    const { createPermissionAnswerEngine } = await import('@/modules/websocket/services/chat-websocket.service.js');
    const { dependencies, spawns } = fakeDependencies();
    pendingAnswers.setEngine(createPermissionAnswerEngine(dependencies));

    const grokSessionId = sessionsDb.createSession('grok-native-1', 'grok', '/workspace/alpha', 'Grok выбирает базу');
    const input = {
      questions: [{
        question: 'Какую базу берём?',
        options: [{ label: 'Postgres' }, { label: 'SQLite' }],
        multiSelect: false,
      }],
    };
    // Grok asked and its CLI exited: the question lives on in Neo3 only.
    sessionAttention.recordRunStart({ appSessionId: grokSessionId, userId: fixture.adminId, provider: 'grok', projectId: fixture.projectId });
    registerGrokQuestion({
      requestId: 'req-grok-1',
      appSessionId: grokSessionId,
      input: input as never,
      providerSessionId: 'grok-native-1',
      resumeOptions: { cwd: '/workspace/alpha', model: 'grok-4.7' },
    });
    sessionAttention.recordRunEvent(
      { appSessionId: grokSessionId, provider: 'grok' },
      { kind: 'permission_request', requestId: 'req-grok-1', toolName: 'AskUserQuestion', input },
    );
    sessionAttention.recordRunEvent({ appSessionId: grokSessionId, provider: 'grok' }, { kind: 'complete', exitCode: 0 });

    const [, sqlite] = pendingAnswers.issueTokens('req-grok-1', fixture.adminId, [
      { id: 'opt1', label: 'Postgres', decision: { allow: true, answers: { 'Какую базу берём?': 'Postgres' } } },
      { id: 'opt2', label: 'SQLite', decision: { allow: true, answers: { 'Какую базу берём?': 'SQLite' } } },
    ]);
    const result = await pendingAnswers.redeemToken(sqlite.token);

    assert.deepEqual(result, { ok: true, label: 'SQLite', sessionId: grokSessionId });
    assert.equal(spawns.length, 1, 'the resumed Grok turn started');
    assert.equal(spawns[0].command, '2. SQLite', 'same answer text a panel click sends');
    assert.equal(spawns[0].options.resume, true);
    assert.equal(spawns[0].options.sessionId, 'grok-native-1');
    assert.equal(spawns[0].options.model, 'grok-4.7');

    spawns[0].writer.send({ kind: 'text', role: 'assistant', content: 'Беру SQLite, начинаю.', provider: 'grok', sessionId: 'grok-native-1' });

    const item = sessionAttention.listForUser({ id: fixture.adminId, role: 'admin' }).find((entry) => entry.sessionId === grokSessionId);
    assert.equal(item?.state, 'working');

    // Later the user opens the session: the live run and what it already said are there.
    const socket = new FakeSocket();
    const { dependencies: openDeps } = fakeDependencies();
    handleChatConnection(socket as never, { user: { userId: fixture.adminId, role: 'admin' } } as never, openDeps);
    await socket.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: grokSessionId, lastSeq: 0 }] });

    const subscribed = socket.frames.find((frame) => frame.kind === 'chat_subscribed');
    assert.equal(subscribed?.isProcessing, true);
    const replayed = socket.frames.find((frame) => frame.kind === 'text');
    assert.equal(replayed?.content, 'Беру SQLite, начинаю.');
    assert.equal(replayed?.sessionId, grokSessionId);
  });
});

test('a Claude question answered from a push resolves the paused request exactly like the panel does', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { pendingAnswers } = await import('@/modules/pending-answers/pending-answers.service.js');
    const { createPermissionAnswerEngine } = await import('@/modules/websocket/services/chat-websocket.service.js');
    const input = {
      questions: [{ question: 'Деплоим сегодня?', options: [{ label: 'Да' }, { label: 'Завтра' }], multiSelect: false }],
    };
    const { dependencies, approvals } = fakeDependencies();
    (dependencies as { getPendingApprovalsForSession: (id: string) => unknown[] }).getPendingApprovalsForSession = (providerSessionId) =>
      providerSessionId === 'provider-alpha' ? [{ requestId: 'req-claude-ask', toolName: 'AskUserQuestion', input }] : [];
    pendingAnswers.setEngine(createPermissionAnswerEngine(dependencies));

    sessionAttention.recordRunStart({ appSessionId: fixture.sessionId, userId: fixture.adminId, provider: 'claude', projectId: fixture.projectId });
    sessionAttention.recordRunEvent(
      { appSessionId: fixture.sessionId, provider: 'claude' },
      { kind: 'permission_request', requestId: 'req-claude-ask', toolName: 'AskUserQuestion', input },
    );

    const [yes] = pendingAnswers.issueTokens('req-claude-ask', fixture.adminId, [
      { id: 'opt1', label: 'Да', decision: { allow: true, answers: { 'Деплоим сегодня?': 'Да' } } },
    ]);
    const result = await pendingAnswers.redeemToken(yes.token);

    assert.equal(result.ok, true);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].requestId, 'req-claude-ask');
    // AskUserQuestionPanel sends { allow: true, updatedInput: { ...input, answers } }.
    assert.equal(approvals[0].payload.allow, true);
    assert.deepEqual(approvals[0].payload.updatedInput, { ...input, answers: { 'Деплоим сегодня?': 'Да' } });
    const item = sessionAttention.listForUser({ id: fixture.adminId, role: 'admin' }).find((entry) => entry.sessionId === fixture.sessionId);
    assert.equal(item?.state, 'working');
  });
});

test('a websocket answer to a request only the engine knows: delivered with project access, refused without', async () => {
  await withIsolatedDatabase(async (fixture) => {
    // The status registry never saw this request (e.g. its update failed); Claude still holds it.
    const { dependencies, approvals } = fakeDependencies();
    (dependencies as { getPendingApprovalById: (id: string) => unknown }).getPendingApprovalById = (requestId) =>
      requestId === 'req-engine-only' ? { requestId, sessionId: 'provider-alpha', toolName: 'Bash', input: { command: 'ls' } } : null;
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.employeeId, role: 'user' } } as never, dependencies);

    await socket.deliver({ type: 'chat.permission-response', requestId: 'req-engine-only', allow: true });
    assert.equal(approvals.length, 0);
    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'PERMISSION_ACCESS_DENIED');

    userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
    await socket.deliver({ type: 'chat.permission-response', requestId: 'req-engine-only', allow: true });
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0].requestId, 'req-engine-only');
  });
});

test('a websocket answer to a request nobody holds is reported back, not dropped', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { dependencies, approvals } = fakeDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.adminId, role: 'admin' } } as never, dependencies);

    await socket.deliver({ type: 'chat.permission-response', requestId: 'req-ghost', allow: true });

    assert.equal(approvals.length, 0);
    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.equal(error?.code, 'PERMISSION_REQUEST_NOT_FOUND');
    assert.equal(error?.requestId, 'req-ghost');
  });
});

test('a Claude question whose original input is gone is not resolved with a stripped input; its buttons stay alive', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { pendingAnswers } = await import('@/modules/pending-answers/pending-answers.service.js');
    const { createPermissionAnswerEngine } = await import('@/modules/websocket/services/chat-websocket.service.js');
    const { dependencies, approvals } = fakeDependencies();
    pendingAnswers.setEngine(createPermissionAnswerEngine(dependencies));
    const input = { questions: [{ question: 'Деплоим?', options: [{ label: 'Да' }], multiSelect: false }] };
    sessionAttention.recordRunStart({ appSessionId: fixture.sessionId, userId: fixture.adminId, provider: 'claude', projectId: fixture.projectId });
    sessionAttention.recordRunEvent(
      { appSessionId: fixture.sessionId, provider: 'claude' },
      { kind: 'permission_request', requestId: 'req-no-input', toolName: 'AskUserQuestion', input },
    );
    const [yes] = pendingAnswers.issueTokens('req-no-input', fixture.adminId, [
      { id: 'opt1', label: 'Да', decision: { allow: true, answers: { 'Деплоим?': 'Да' } } },
    ]);

    const result = await pendingAnswers.redeemToken(yes.token);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unavailable');
    assert.equal(approvals.length, 0);
    const item = sessionAttention.listForUser({ id: fixture.adminId, role: 'admin' }).find((entry) => entry.sessionId === fixture.sessionId);
    assert.equal(item?.state, 'waiting');
  });
});

test('a Grok question whose resumed turn cannot start goes back to its store and can be answered later', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { pendingAnswers } = await import('@/modules/pending-answers/pending-answers.service.js');
    const { createPermissionAnswerEngine } = await import('@/modules/websocket/services/chat-websocket.service.js');
    const { dependencies, spawns } = fakeDependencies();
    pendingAnswers.setEngine(createPermissionAnswerEngine(dependencies));
    const grokSessionId = sessionsDb.createSession('grok-native-2', 'grok', '/workspace/alpha', 'Grok занят');
    const input = { questions: [{ question: 'Куда?', options: [{ label: 'Сюда' }, { label: 'Туда' }], multiSelect: false }] };
    registerGrokQuestion({ requestId: 'req-grok-busy', appSessionId: grokSessionId, input: input as never, providerSessionId: 'grok-native-2' });
    // Another turn of this session is still running: the resume cannot be registered.
    const busy = chatRunRegistry.startRun({ appSessionId: grokSessionId, provider: 'grok', providerSessionId: 'grok-native-2', connection: new FakeSocket() as never, userId: fixture.adminId });
    assert.ok(busy);
    const [here] = pendingAnswers.issueTokens('req-grok-busy', fixture.adminId, [
      { id: 'opt1', label: 'Сюда', decision: { allow: true, answers: { 'Куда?': 'Сюда' } } },
    ]);

    const refused = await pendingAnswers.redeemToken(here.token);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'unavailable');
    assert.equal(spawns.length, 0);
    assert.equal(peekGrokQuestion('req-grok-busy')?.appSessionId, grokSessionId, 'the question is open again');

    chatRunRegistry.completeRun(grokSessionId, { exitCode: 0 });
    const answered = await pendingAnswers.redeemToken(here.token);
    assert.equal(answered.ok, true);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].command, '1. Сюда');
  });
});

/** Gateway deps whose Claude runtime only records that a turn started. */
function chatSendDependencies() {
  const started: string[] = [];
  const dependencies = {
    // Fake project folders: the jail has its own tests (chat-user-jail.test.ts).
    userJailFor: () => null,
    spawnFns: {
      claude: async (command: string) => {
        started.push(command);
      },
    },
    abortFns: {},
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
  } as unknown as Parameters<typeof handleChatConnection>[2];
  return { dependencies, started };
}

test('chat.send keeps its old scope: a token without a role belongs to an admin with no grants and still chats', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { dependencies, started } = chatSendDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.adminId } } as never, dependencies);

    await socket.deliver({ type: 'chat.send', sessionId: fixture.sessionId, content: 'привет' });

    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error'), undefined);
    assert.deepEqual(started, ['привет']);
  });
});

function insertSessionWithoutProject(): void {
  getConnection().prepare(
    `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
     VALUES ('sess-no-project', 'claude', NULL, NULL, NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run();
}

test('chat.send into a session without a project path is refused for an employee', async () => {
  await withIsolatedDatabase(async (fixture) => {
    insertSessionWithoutProject();
    const { dependencies, started } = chatSendDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.employeeId, role: 'user' } } as never, dependencies);

    await socket.deliver({ type: 'chat.send', sessionId: 'sess-no-project', content: 'без проекта' });

    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'PROJECT_ACCESS_DENIED');
    assert.deepEqual(started, []);
  });
});

test('chat.send into a session without a project path works for an admin', async () => {
  await withIsolatedDatabase(async (fixture) => {
    insertSessionWithoutProject();
    const { dependencies, started } = chatSendDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.adminId, role: 'admin' } } as never, dependencies);

    await socket.deliver({ type: 'chat.send', sessionId: 'sess-no-project', content: 'админ без проекта' });

    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error'), undefined);
    assert.deepEqual(started, ['админ без проекта']);
  });
});

test('chat.send over a socket without a user id is refused', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { dependencies, started } = chatSendDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { username: 'nobody' } } as never, dependencies);

    await socket.deliver({ type: 'chat.send', sessionId: fixture.sessionId, content: 'кто я' });

    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'PROJECT_ACCESS_DENIED');
    assert.deepEqual(started, []);
  });
});

test('chat.send by an employee: refused without a project grant, works with one', async () => {
  await withIsolatedDatabase(async (fixture) => {
    const { dependencies, started } = chatSendDependencies();
    const socket = new FakeSocket();
    handleChatConnection(socket as never, { user: { userId: fixture.employeeId, role: 'user' } } as never, dependencies);

    await socket.deliver({ type: 'chat.send', sessionId: fixture.sessionId, content: 'первая' });
    assert.equal(socket.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'PROJECT_ACCESS_DENIED');
    assert.deepEqual(started, []);

    userProjectAccessDb.grantAccess(fixture.employeeId, fixture.projectId, fixture.adminId);
    await socket.deliver({ type: 'chat.send', sessionId: fixture.sessionId, content: 'вторая' });
    assert.deepEqual(started, ['вторая']);
  });
});
