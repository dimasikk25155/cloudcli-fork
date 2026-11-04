import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { createMasterSessionRouter, createMasterSessionService } from '@/modules/master-session/index.js';
import { createSessionAttentionService } from '@/modules/session-attention/index.js';
import { AppError } from '@/shared/utils.js';

// HTTP /api/master-session with the real status registry and the real
// project-access rule: Dima (admin) gets every waiting question, an employee
// only those of projects granted to them; «Панель диалогов» off → 409 MOD_OFF.

type Who = { id: number; role: string };

async function withServer(runTest: (input: {
  base: string;
  as: (who: Who) => void;
  admin: Who;
  employee: Who;
  alpha: string;
  beta: string;
  setModOn: (on: boolean) => void;
  sends: Array<{ sessionId: string; userId: number; content: string }>;
}) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'master-session-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const server = { close: () => {} } as { close: () => void };
  try {
    const adminId = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const employeeId = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const alpha = sessionsDb.createSession('sess-alpha', 'codex', '/workspace/alpha', 'Альфа');
    const beta = sessionsDb.createSession('sess-beta', 'grok', '/workspace/beta', 'Бета');
    const alphaProject = projectsDb.getProjectPath('/workspace/alpha')!.project_id;
    const betaProject = projectsDb.getProjectPath('/workspace/beta')!.project_id;
    userProjectAccessDb.grantAccess(employeeId, betaProject, adminId);

    const attention = createSessionAttentionService({ broadcast: () => {}, fetchLastAssistantText: async () => null });
    const ask = (sessionId: string, provider: string, projectId: string, text: string) => {
      const run = { appSessionId: sessionId, provider, userId: adminId, projectId };
      attention.recordRunStart(run);
      attention.recordRunEvent(run, { kind: 'text', role: 'assistant', content: text });
      attention.recordRunEvent(run, { kind: 'complete', exitCode: 0, aborted: false });
    };
    ask(alpha, 'codex', alphaProject, 'Какой вариант берём?');
    ask(beta, 'grok', betaProject, 'Публиковать сейчас или завтра?');

    let modOn = true;
    const sends: Array<{ sessionId: string; userId: number; content: string }> = [];
    const service = createMasterSessionService({
      attention,
      pendingAnswers: { answer: async () => ({ ok: true }) },
      send: (input) => { sends.push(input); return true; },
      drafts: async () => '{"drafts":[]}',
      sessionProjectPath: (sessionId) => sessionsDb.getSessionById(sessionId)?.project_path ?? null,
      isModOn: () => modOn,
    });

    let current: Who = { id: adminId, role: 'admin' };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as express.Request & { user: Who }).user = current; next(); });
    app.use('/api/master-session', createMasterSessionRouter(() => service));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
        return;
      }
      res.status(500).json({ success: false });
    });
    const listening = app.listen(0, '127.0.0.1');
    server.close = () => listening.close();
    await once(listening, 'listening');

    await runTest({
      base: `http://127.0.0.1:${(listening.address() as AddressInfo).port}/api/master-session`,
      as: (who) => { current = who; },
      admin: { id: adminId, role: 'admin' },
      employee: { id: employeeId, role: 'user' },
      alpha,
      beta,
      setModOn: (on) => { modOn = on; },
      sends,
    });
  } finally {
    server.close();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type QuestionsBody = { data: { questions: Array<{ sessionId: string; mode: string; question: string; updatedAt: string }> } };

test('questions: the admin sees every waiting chat, an employee only granted projects', async () => {
  await withServer(async ({ base, as, admin, employee, alpha, beta }) => {
    as(admin);
    const forAdmin = await (await fetch(`${base}/questions`)).json() as QuestionsBody;
    assert.deepEqual(forAdmin.data.questions.map((entry) => entry.sessionId).sort(), [alpha, beta].sort());
    assert.ok(forAdmin.data.questions.every((entry) => entry.mode === 'text'));

    as(employee);
    const forEmployee = await (await fetch(`${base}/questions`)).json() as QuestionsBody;
    assert.deepEqual(forEmployee.data.questions.map((entry) => entry.sessionId), [beta]);
    assert.equal(forEmployee.data.questions[0].question, 'Публиковать сейчас или завтра?');
  });
});

test('send: an employee cannot answer a chat of a project not granted to them', async () => {
  await withServer(async ({ base, as, admin, employee, alpha, sends }) => {
    as(admin);
    const forAdmin = await (await fetch(`${base}/questions`)).json() as QuestionsBody;
    const alphaQuestion = forAdmin.data.questions.find((entry) => entry.sessionId === alpha)!;

    as(employee);
    const response = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: 'batch-http-1', items: [{ sessionId: alpha, expectedUpdatedAt: alphaQuestion.updatedAt, answer: { text: 'Первый' } }] }),
    });
    const body = await response.json() as { data: { results: Array<{ status: string; reason?: string }> } };
    assert.deepEqual(body.data.results, [{ sessionId: alpha, status: 'failed', reason: 'forbidden' }]);
    assert.equal(sends.length, 0);
  });
});

test('mod off: the routes answer 409 MOD_OFF', async () => {
  await withServer(async ({ base, setModOn }) => {
    setModOn(false);
    for (const [method, url, body] of [
      ['GET', '/questions', undefined],
      ['POST', '/drafts', { sessionIds: ['x'] }],
      ['POST', '/send', { batchId: 'batch-http-2', items: [] }],
    ] as const) {
      const response = await fetch(`${base}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 409, url);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'MOD_OFF', url);
    }
  });
});
