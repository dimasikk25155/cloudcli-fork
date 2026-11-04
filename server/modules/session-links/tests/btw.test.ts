import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  BTW_CONTEXT_MAX,
  buildBtwFirstMessage,
  createBtwRoutes,
  createBtwService,
  getSessionLinks,
  type BtwRunStart,
} from '@/modules/session-links/index.js';

import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks.js';

type World = { admin: { id: number }; projectA: string };

async function withWorld(runTest: (world: World) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'session-btw-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = userDb.createUserWithRole('owner', 'unused', 'admin');
    const projectA = projectsDb.createProjectPath('/workspace/btw-a').project!;
    await runTest({ admin: { id: Number(admin.id) }, projectA: projectA.project_path });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

/** A fake chat gateway: records every run asked for, starts all of them. */
function fakeRunControl() {
  const runs: BtwRunStart[] = [];
  return { runs, control: { start: (input: BtwRunStart) => { runs.push(input); return true; } } };
}

const PARENT_REPLY = 'Сделал миграцию, осталось проверить индексы.';

function serviceFor(runControl: { start: (input: BtwRunStart) => boolean } | null, modOn = true) {
  let created = 0;
  return createBtwService({
    isModOn: () => modOn,
    fetchMessages: async () => [
      { kind: 'text', role: 'user', content: 'Сделай миграцию' },
      { kind: 'text', role: 'assistant', content: PARENT_REPLY },
      // The parent is busy: Dima already wrote again, the agent is working on it.
      { kind: 'text', role: 'user', content: 'Теперь индексы' },
    ],
    lastRunOptions: (sessionId) => (sessionId === 'parent-codex'
      ? { model: 'gpt-5.5-codex', effort: 'high', permissionMode: 'bypassPermissions' }
      : null),
    createSession: (provider, projectPath) => {
      created += 1;
      const id = `btw-child-${created}`;
      sessionsDb.createAppSession(id, provider, projectPath);
      return id;
    },
    broadcastUpsert: () => {},
    runControl: runControl ?? undefined,
  });
}

test('the side-chat block is cut from bubbles and from session titles', () => {
  const sent = buildBtwFirstMessage({
    question: 'почему упал тест?',
    quote: 'assert.equal(a, b)',
    lastReply: PARENT_REPLY,
  });
  assert.match(sent, /<btw_context>[\s\S]*assert\.equal\(a, b\)[\s\S]*<\/btw_context>/);
  // Bubbles (visibleUserText) and the engines' title makers all cut agent-only blocks with this.
  assert.equal(stripAgentOnlyBlocks(sent), 'почему упал тест?');
  assert.equal(stripAgentOnlyBlocks(`${sent}\n\nи ещё`), 'почему упал тест?\n\nи ещё');
});

test('the hidden context keeps the quote and the parent reply within 4000 characters', () => {
  const sent = buildBtwFirstMessage({ question: 'что это?', quote: 'ц'.repeat(9000), lastReply: 'о'.repeat(9000) });
  const block = sent.match(/<btw_context>[\s\S]*<\/btw_context>/)?.[0] ?? '';
  assert.ok(block.length > 0);
  assert.ok(block.length <= 4000, `block is ${block.length} chars`);
  assert.equal(BTW_CONTEXT_MAX, 4000);
  assert.match(block, /ц{100}/);
  assert.match(block, /о{100}/);
});

for (const [provider, model, effort] of [
  ['claude', 'opus[1m]', 'xhigh'],
  ['codex', 'gpt-5.5-codex', 'high'],
  ['grok', 'grok-4.7', null],
] as const) {
  test(`/btw on a ${provider} chat opens a btw child on the same engine, model and effort`, async () => {
    await withWorld(async ({ admin, projectA }) => {
      const parentId = provider === 'codex' ? 'parent-codex' : `parent-${provider}`;
      sessionsDb.createAppSession(parentId, provider, projectA);
      sessionsDb.updateSessionModel(parentId, model);
      sessionsDb.updateSessionEffort(parentId, effort);
      const { runs, control } = fakeRunControl();

      const result = await serviceFor(control).start({
        parentSessionId: parentId,
        user: admin,
        question: 'а зачем индекс?',
        quote: 'CREATE INDEX',
      });

      const child = sessionsDb.getSessionById(result.sessionId);
      assert.equal(child?.provider, provider);
      // The sidebar title is the question, never the hidden block.
      assert.equal(child?.custom_name, 'Побочный: а зачем индекс?');
      assert.equal(child?.model ?? null, model);
      assert.equal(child?.effort ?? null, effort);
      assert.equal(getSessionLinks(result.sessionId, admin).parent?.sessionId, parentId);
      assert.equal(getSessionLinks(result.sessionId, admin).parent?.relation, 'btw');

      // Exactly one run, in the child — the parent's own run is left alone.
      assert.equal(runs.length, 1);
      assert.equal(runs[0].sessionId, result.sessionId);
      assert.equal(runs[0].userId, admin.id);
      assert.equal(runs[0].options.model, model);
      assert.equal(runs[0].options.effort ?? null, effort);
      assert.ok(runs.every((run) => run.sessionId !== parentId));
      assert.equal(stripAgentOnlyBlocks(runs[0].content), 'а зачем индекс?');
      assert.match(runs[0].content, /CREATE INDEX/);
      // The parent's last answer, although Dima already wrote after it.
      assert.ok(runs[0].content.includes(PARENT_REPLY));
    });
  });
}

test('a busy parent is not interrupted: the side chat starts while it works', async () => {
  await withWorld(async ({ admin, projectA }) => {
    sessionsDb.createAppSession('busy-parent', 'claude', projectA);
    const { runs, control } = fakeRunControl();
    const service = serviceFor(control);

    const first = await service.start({ parentSessionId: 'busy-parent', user: admin, question: 'первый вопрос' });
    const second = await service.start({ parentSessionId: 'busy-parent', user: admin, question: 'второй вопрос' });

    assert.notEqual(first.sessionId, second.sessionId);
    assert.deepEqual(runs.map((run) => run.sessionId), [first.sessionId, second.sessionId]);
    assert.deepEqual(
      getSessionLinks('busy-parent', admin).children.map((child) => [child.sessionId, child.relation]),
      [[first.sessionId, 'btw'], [second.sessionId, 'btw']],
    );
  });
});

test('a child whose first run did not start is removed', async () => {
  await withWorld(async ({ admin, projectA }) => {
    sessionsDb.createAppSession('parent-x', 'grok', projectA);
    const service = serviceFor({ start: () => false });
    await assert.rejects(
      () => service.start({ parentSessionId: 'parent-x', user: admin, question: 'вопрос' }),
      { code: 'BTW_NOT_STARTED' },
    );
    assert.deepEqual(getSessionLinks('parent-x', admin).children, []);
    assert.equal(sessionsDb.getSessionById('btw-child-1') ?? null, null);
  });
});

test('POST /api/sessions/:id/btw → 201 {sessionId}; an empty question 400; mod off 409 MOD_OFF', async () => {
  await withWorld(async ({ admin, projectA }) => {
    sessionsDb.createAppSession('http-parent', 'claude', projectA);
    const { runs, control } = fakeRunControl();
    let modOn = true;
    const service = createBtwService({
      isModOn: () => modOn,
      fetchMessages: async () => [],
      createSession: (provider, projectPath) => {
        const id = `http-child-${runs.length + 1}`;
        sessionsDb.createAppSession(id, provider, projectPath);
        return id;
      },
      broadcastUpsert: () => {},
      runControl: control,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { id: admin.id, role: 'admin' } });
      next();
    });
    app.use('/api/sessions', createBtwRoutes(service));
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ error: { code: err.code } });
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/sessions`;
    const ask = (body: Record<string, unknown>) => fetch(`${base}/http-parent/btw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    try {
      const created = await ask({ question: 'что там с тестами?', quote: 'FAIL' });
      assert.equal(created.status, 201);
      const body = (await created.json()) as { data: { sessionId: string; relation: string } };
      assert.equal(body.data.sessionId, 'http-child-1');
      assert.equal(body.data.relation, 'btw');

      const empty = await ask({ question: '   ' });
      assert.equal(empty.status, 400);
      assert.equal(((await empty.json()) as { error: { code: string } }).error.code, 'BTW_QUESTION_REQUIRED');

      modOn = false;
      const off = await ask({ question: 'ещё вопрос' });
      assert.equal(off.status, 409);
      assert.equal(((await off.json()) as { error: { code: string } }).error.code, 'MOD_OFF');
      assert.equal(runs.length, 1);
    } finally {
      server.close();
    }
  });
});

test('without the chat gateway the route says the side chat is unavailable and creates nothing', async () => {
  await withWorld(async ({ admin, projectA }) => {
    sessionsDb.createAppSession('lonely-parent', 'claude', projectA);
    await assert.rejects(
      () => serviceFor(null).start({ parentSessionId: 'lonely-parent', user: admin, question: 'вопрос' }),
      { code: 'BTW_UNAVAILABLE', statusCode: 503 },
    );
    assert.deepEqual(getSessionLinks('lonely-parent', admin).children, []);
  });
});
