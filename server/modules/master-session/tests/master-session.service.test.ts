import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createMasterSessionService, createWorkspaceMasterSendLedger, type MasterSessionDependencies } from '@/modules/master-session/index.js';
import type { AttentionItem, AttentionUser } from '@/modules/session-attention/index.js';
import { AppError } from '@/shared/utils.js';

// Master session (истории 31–33) on fakes: the list follows the attention
// registry's access rule, structural questions go to pending-answers, text
// questions become an ordinary chat message, a changed chat is not answered,
// and a repeated batch delivers nothing twice.

const ADMIN: AttentionUser = { id: 1, role: 'admin' };
const MATE: AttentionUser = { id: 7, role: 'user' };

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    sessionId: 's1',
    projectId: 'p1',
    projectName: 'Проект',
    provider: 'claude',
    title: 'Чат',
    state: 'waiting',
    reason: 'ask',
    detail: null,
    updatedAt: '2026-11-04T10:00:00.000Z',
    unread: true,
    model: null,
    lastModelAt: null,
    ...overrides,
  };
}

const ASK = item({
  sessionId: 'ask',
  projectId: 'p1',
  reason: 'ask',
  detail: {
    question: 'Какой цвет?',
    requestId: 'req-1',
    questions: [{ question: 'Какой цвет?', options: [{ label: 'Синий' }, { label: 'Красный' }], multiSelect: false }],
  },
});
const TEXT = item({
  sessionId: 'text',
  projectId: 'p2',
  provider: 'codex',
  reason: 'manual_ask',
  detail: { excerpt: 'Пришли, пожалуйста, ключ доступа к API.' },
});
const WORKING = item({ sessionId: 'busy', state: 'working', reason: null });
const OTHER_PROJECT = item({ sessionId: 'foreign', projectId: 'p9', reason: 'text_question', detail: { question: 'Делать?' } });

type Calls = {
  answers: Array<{ requestId: string; decision: unknown; actorUserId: unknown; via: string }>;
  sends: Array<{ sessionId: string; userId: number; content: string }>;
  prompts: Array<{ userId: number; projectPath: string; prompt: string }>;
};

function setup(overrides: Partial<MasterSessionDependencies> = {}) {
  let items: AttentionItem[] = [ASK, TEXT, WORKING, OTHER_PROJECT];
  const calls: Calls = { answers: [], sends: [], prompts: [] };
  const service = createMasterSessionService({
    attention: {
      // Same rule as the registry: admins see all, others only granted projects.
      listForUser: (user) => (user.role === 'admin' ? items : items.filter((entry) => entry.projectId === 'p1')),
    },
    pendingAnswers: {
      answer: async (input) => {
        calls.answers.push(input);
        return { ok: true };
      },
    },
    send: async (input) => {
      calls.sends.push(input);
      return true;
    },
    drafts: async (input) => {
      calls.prompts.push(input);
      return JSON.stringify({ drafts: [
        { sessionId: 'ask', text: '', choice: 'opt1' },
        { sessionId: 'text', text: 'Ключ положил в .secrets.env, имя переменной OPENAI_API_KEY.' },
      ] });
    },
    sessionProjectPath: (sessionId) => `/projects/${sessionId}`,
    isModOn: () => true,
    ...overrides,
  });
  return { service, calls, setItems: (next: AttentionItem[]) => { items = next; } };
}

test('questions: only waiting sessions the user may see, with choices of a structural one', async () => {
  const { service } = setup();
  const forAdmin = service.listQuestions(ADMIN);
  assert.deepEqual(forAdmin.map((entry) => entry.sessionId), ['ask', 'text', 'foreign']);
  const ask = forAdmin.find((entry) => entry.sessionId === 'ask');
  assert.equal(ask?.mode, 'choice');
  assert.deepEqual(ask?.choices.map((choice) => choice.label), ['Синий', 'Красный']);
  assert.equal(ask?.question, 'Какой цвет?');
  const text = forAdmin.find((entry) => entry.sessionId === 'text');
  assert.equal(text?.mode, 'text');
  assert.deepEqual(text?.choices, []);
  assert.equal(text?.question, 'Пришли, пожалуйста, ключ доступа к API.');

  const forMate = service.listQuestions(MATE);
  assert.deepEqual(forMate.map((entry) => entry.sessionId), ['ask']);
});

test('send: a structural answer goes to pending-answers, a text answer becomes a chat message', async () => {
  const { service, calls } = setup();
  const result = await service.send(ADMIN, {
    batchId: 'batch-0001',
    items: [
      { sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { choice: 'opt2' } },
      { sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Ключ в файле секретов' } },
    ],
  });
  assert.deepEqual(result.results.map((entry) => [entry.sessionId, entry.status]), [['ask', 'sent'], ['text', 'sent']]);
  assert.equal(calls.answers.length, 1);
  assert.equal(calls.answers[0].requestId, 'req-1');
  assert.deepEqual(calls.answers[0].decision, { allow: true, answers: { 'Какой цвет?': 'Красный' } });
  assert.equal(calls.answers[0].actorUserId, 1);
  assert.deepEqual(calls.sends, [{ sessionId: 'text', userId: 1, content: 'Ключ в файле секретов' }]);
});

test('send: free text on a structural question is the answer to its question', async () => {
  const { service, calls } = setup();
  await service.send(ADMIN, {
    batchId: 'batch-0002',
    items: [{ sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { text: 'Зелёный' } }],
  });
  assert.deepEqual(calls.answers[0].decision, { allow: true, answers: { 'Какой цвет?': 'Зелёный' } });
  assert.equal(calls.sends.length, 0);
});

test('send: a chat that changed after preparation is stale and gets nothing', async () => {
  const { service, calls, setItems } = setup();
  setItems([{ ...ASK, updatedAt: '2026-11-04T10:05:00.000Z' }, { ...TEXT, state: 'working', reason: null }]);
  const result = await service.send(ADMIN, {
    batchId: 'batch-0003',
    items: [
      { sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { choice: 'opt1' } },
      { sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Готово' } },
    ],
  });
  assert.deepEqual(result.results.map((entry) => entry.status), ['stale', 'stale']);
  assert.equal(calls.answers.length, 0);
  assert.equal(calls.sends.length, 0);
});

test('send: the same batch pressed twice delivers once and repeats the first result', async () => {
  const { service, calls } = setup();
  const request = {
    batchId: 'batch-0004',
    items: [
      { sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { choice: 'opt1' } },
      { sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Да' } },
    ],
  };
  const [first, second] = await Promise.all([service.send(ADMIN, request), service.send(ADMIN, request)]);
  const third = await service.send(ADMIN, request);
  assert.deepEqual(first.results.map((entry) => entry.status), ['sent', 'sent']);
  assert.deepEqual(second.results.map((entry) => entry.status), ['sent', 'sent']);
  assert.deepEqual(third.results.map((entry) => entry.status), ['sent', 'sent']);
  assert.equal(calls.answers.length, 1);
  assert.equal(calls.sends.length, 1);
});

test('send: a session the user cannot see is refused, not delivered', async () => {
  const { service, calls } = setup();
  const result = await service.send(MATE, {
    batchId: 'batch-0005',
    items: [{ sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Да' } }],
  });
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].reason, 'forbidden');
  assert.equal(calls.sends.length, 0);
});

test('send: an engine that did not take the answer is a failure with its reason', async () => {
  const { service } = setup({
    pendingAnswers: { answer: async () => ({ ok: false, reason: 'not_pending' }) },
    send: async () => false,
  });
  const result = await service.send(ADMIN, {
    batchId: 'batch-0006',
    items: [
      { sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { choice: 'opt1' } },
      { sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Да' } },
    ],
  });
  assert.deepEqual(result.results.map((entry) => [entry.status, entry.reason]), [['failed', 'not_pending'], ['failed', 'not_started']]);
});

test('drafts: model answers are matched to the questions; a choice outside the options is dropped', async () => {
  const { service, calls } = setup({
    drafts: async (input) => {
      calls.prompts.push(input);
      return 'Вот ответы:\n```json\n{"drafts":[{"sessionId":"ask","text":"","choice":"opt9"},{"sessionId":"text","text":"Сделаю сам"},{"sessionId":"busy","text":"лишнее"}]}\n```';
    },
  });
  const result = await service.prepareDrafts(ADMIN, { sessionIds: ['ask', 'text'] });
  assert.deepEqual(result.drafts, [
    { sessionId: 'ask', text: '', updatedAt: ASK.updatedAt },
    { sessionId: 'text', text: 'Сделаю сам', updatedAt: TEXT.updatedAt },
  ]);
  assert.equal(calls.prompts.length, 1);
  assert.equal(calls.prompts[0].userId, 1);
  assert.match(calls.prompts[0].prompt, /Какой цвет\?/);
  assert.match(calls.prompts[0].prompt, /opt1/);
});

test('drafts: a model failure is a plain-language error', async () => {
  const { service } = setup({ drafts: async () => { throw new Error('spawn claude ENOENT'); } });
  await assert.rejects(
    service.prepareDrafts(ADMIN, { sessionIds: ['ask'] }),
    (error: unknown) => error instanceof AppError && error.code === 'DRAFTS_FAILED' && /вручную/.test(error.message),
  );
});

test('drafts: an unreadable model reply is the same plain-language error', async () => {
  const { service } = setup({ drafts: async () => 'не знаю' });
  await assert.rejects(
    service.prepareDrafts(ADMIN, { sessionIds: ['ask'] }),
    (error: unknown) => error instanceof AppError && error.code === 'DRAFTS_FAILED',
  );
});

test('mod off: every operation is 409 MOD_OFF', async () => {
  const { service, calls } = setup({ isModOn: () => false });
  assert.throws(() => service.listQuestions(ADMIN), (error: unknown) => error instanceof AppError && error.code === 'MOD_OFF' && error.statusCode === 409);
  await assert.rejects(service.prepareDrafts(ADMIN, { sessionIds: ['ask'] }), (error: unknown) => error instanceof AppError && error.code === 'MOD_OFF');
  await assert.rejects(
    service.send(ADMIN, { batchId: 'batch-0007', items: [{ sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Да' } }] }),
    (error: unknown) => error instanceof AppError && error.code === 'MOD_OFF',
  );
  assert.equal(calls.sends.length, 0);
});

// R09: the «already sent» memory outlives a server restart — a new service
// instance on the same workspace store repeats the first result.
function workspaceStore() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  return { db, store: createWorkspaceStore(db) };
}

const RESTART_BATCH = {
  batchId: 'batch-restart-1',
  items: [
    { sessionId: 'ask', expectedUpdatedAt: ASK.updatedAt, answer: { choice: 'opt1' } },
    { sessionId: 'text', expectedUpdatedAt: TEXT.updatedAt, answer: { text: 'Да' } },
  ],
};

test('send: the same batch after a restart is not delivered again, the first result comes back', async () => {
  const { db, store } = workspaceStore();
  let clock = Date.parse('2026-11-04T12:00:00.000Z');
  const before = setup({ ledger: createWorkspaceMasterSendLedger(store), now: () => clock });
  const first = await before.service.send(ADMIN, RESTART_BATCH);
  assert.deepEqual(first.results.map((entry) => entry.status), ['sent', 'sent']);

  clock += 60_000;
  const after = setup({ ledger: createWorkspaceMasterSendLedger(store), now: () => clock });
  const again = await after.service.send(ADMIN, RESTART_BATCH);

  assert.deepEqual(again.results, first.results);
  assert.equal(after.calls.answers.length, 0);
  assert.equal(after.calls.sends.length, 0);
  const rows = db.prepare("SELECT kind, owner_user_id FROM workspace_records WHERE kind = 'master-send'").all() as Array<{ owner_user_id: number }>;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.owner_user_id === ADMIN.id));
});

test('send: a failed delivery is not remembered — after a restart the same batch tries again', async () => {
  const { store } = workspaceStore();
  const before = setup({ ledger: createWorkspaceMasterSendLedger(store), send: async () => false });
  const first = await before.service.send(ADMIN, { ...RESTART_BATCH, items: [RESTART_BATCH.items[1]] });
  assert.deepEqual(first.results.map((entry) => [entry.status, entry.reason]), [['failed', 'not_started']]);

  const after = setup({ ledger: createWorkspaceMasterSendLedger(store) });
  const again = await after.service.send(ADMIN, { ...RESTART_BATCH, items: [RESTART_BATCH.items[1]] });
  assert.deepEqual(again.results.map((entry) => entry.status), ['sent']);
  assert.equal(after.calls.sends.length, 1);
});

test('send: after 24 hours the same batch id is a new press', async () => {
  const { store } = workspaceStore();
  let clock = Date.parse('2026-11-04T12:00:00.000Z');
  const before = setup({ ledger: createWorkspaceMasterSendLedger(store), now: () => clock });
  await before.service.send(ADMIN, { ...RESTART_BATCH, items: [RESTART_BATCH.items[1]] });

  clock += 24 * 60 * 60 * 1000 + 1;
  const after = setup({ ledger: createWorkspaceMasterSendLedger(store), now: () => clock });
  await after.service.send(ADMIN, { ...RESTART_BATCH, items: [RESTART_BATCH.items[1]] });
  assert.equal(after.calls.sends.length, 1);
});
