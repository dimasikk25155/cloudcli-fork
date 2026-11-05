import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import type { AgentRunStart } from '@/modules/agents/index.js';

process.env.JWT_SECRET = 'agents-routes-test-secret-0123456789abcdef';
const { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb } = await import('@/modules/database/index.js');
// eslint-disable-next-line boundaries/no-unknown -- the real auth middleware: 401/403 exactly as mounted in server/index.js
const { authenticateToken, generateToken, requireAdmin } = await import('@/middleware/auth.js');
const { apiErrorHandler } = await import('@/shared/utils.js');
const { createAgentsRouter, createAgentsService } = await import('@/modules/agents/index.js');
const { stripAgentOnlyBlocks } = await import('../../../../shared/agent-only-blocks.js');

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Reply = { status: number; body: any };

async function withServer(run: (ctx: {
  call: (method: Method, route: string, options?: { as?: 'admin' | 'member' | 'nobody'; body?: unknown }) => Promise<Reply>;
  setModOn: (on: boolean) => void;
  starts: AgentRunStart[];
  project: string;
  foreignChat: string;
}) => Promise<void>) {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'agents-routes-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = userDb.createUserWithRole('dima', 'unused', 'admin');
  const member = userDb.createUserWithRole('slavik', 'unused', 'user');
  const projectDir = path.join(directory, 'tyres');
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, 'style.md'), '# стиль');
  const project = projectsDb.createProjectPath(projectDir).project!.project_path;
  sessionsDb.createAppSession('plain-chat', 'grok', project);

  let modOn = true;
  const starts: AgentRunStart[] = [];
  let chatNumber = 0;
  const service = createAgentsService({
    listModels: async () => [],
    createSession: (provider, projectPath) => {
      chatNumber += 1;
      const sessionId = `agent-chat-${chatNumber}`;
      sessionsDb.createAppSession(sessionId, provider, projectPath);
      return { sessionId };
    },
    broadcastUpsert: () => {},
  });
  service.setRunControl({ start: (input) => { starts.push(input); return true; } });
  const tokens = {
    admin: generateToken({ id: Number(admin.id), username: 'dima' }),
    member: generateToken({ id: Number(member.id), username: 'slavik' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/agents', authenticateToken, requireAdmin, createAgentsRouter({ service, modOn: () => modOn }));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents`;
  const silence = console.error;
  console.error = () => {};
  try {
    await run({
      call: async (method, route, options = {}) => {
        const as = options.as ?? 'admin';
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (as !== 'nobody') headers.authorization = `Bearer ${tokens[as]}`;
        const response = await fetch(`${base}${route}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return { status: response.status, body: await response.json() };
      },
      setModOn: (on) => { modOn = on; },
      starts,
      project,
      foreignChat: 'plain-chat',
    });
  } finally {
    console.error = silence;
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('/api/agents: 401 without login, 403 for a teammate, 409 MOD_OFF when «Агенты» is off', async () => {
  await withServer(async ({ call, setModOn, project }) => {
    assert.equal((await call('GET', '/', { as: 'nobody' })).status, 401);
    assert.equal((await call('GET', '/', { as: 'member' })).status, 403);
    assert.equal((await call('POST', '/', { as: 'member', body: { name: 'x' } })).status, 403);
    assert.equal((await call('POST', '/some-id/chat', { as: 'member', body: { task: 'x' } })).status, 403);

    setModOn(false);
    for (const reply of [
      await call('GET', '/'),
      await call('POST', '/', { body: { name: 'Художник', role: 'r', provider: 'grok', projectPath: project } }),
      await call('POST', '/some-id/chat', { body: { task: 'x' } }),
      await call('GET', '/by-session/plain-chat'),
    ]) {
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error.code, 'MOD_OFF');
    }
  });
});

test('/api/agents: create, list, change, rules with versions, chat, the chat\'s agent, delete', async () => {
  await withServer(async ({ call, starts, project, foreignChat }) => {
    const created = await call('POST', '/', {
      body: { name: 'Художник', role: 'Перерисовываешь карточки.', checks: 'Сверь размер.', provider: 'grok', model: 'grok-4.7', projectPath: project, files: ['style.md'] },
    });
    assert.equal(created.status, 200);
    const agent = created.body.data.agent;
    assert.equal(agent.name, 'Художник');
    assert.deepEqual(agent.files, [path.join(project, 'style.md')]);

    const refused = await call('POST', '/', { body: { name: 'художник', role: 'r', provider: 'grok', projectPath: project } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'AGENT_NAME_TAKEN');
    assert.equal((await call('POST', '/', { body: { name: 'Другой', role: 'r', provider: 'grok', projectPath: project, files: ['../x'] } })).body.error.code, 'FILE_OUTSIDE_PROJECT');

    assert.deepEqual((await call('GET', '/')).body.data.agents.map((item: { id: string }) => item.id), [agent.id]);
    assert.equal((await call('PUT', `/${agent.id}`, { body: { checks: 'Сверь размер и бренд.' } })).body.data.agent.checks, 'Сверь размер и бренд.');
    assert.equal((await call('GET', `/${agent.id}`)).body.data.agent.checks, 'Сверь размер и бренд.');

    const added = await call('POST', `/${agent.id}/rules`, { body: { text: 'До 4 переделок' } });
    assert.equal(added.body.data.version, 1);
    const ruleId = added.body.data.rules[0].id;
    assert.equal((await call('POST', `/${agent.id}/rules`, { body: { text: 'Не писать CDEK' } })).body.data.version, 2);
    const afterRemove = await call('DELETE', `/${agent.id}/rules/${ruleId}`);
    assert.equal(afterRemove.body.data.version, 3);
    assert.deepEqual(afterRemove.body.data.rules.map((rule: { text: string }) => rule.text), ['Не писать CDEK']);
    assert.equal((await call('GET', `/${agent.id}/rules`)).body.data.history.length, 3);

    const chat = await call('POST', `/${agent.id}/chat`, { body: { task: 'Перерисуй Pirelli' } });
    assert.equal(chat.status, 200);
    const sessionId = chat.body.data.sessionId;
    assert.equal(starts.length, 1);
    assert.equal(starts[0].sessionId, sessionId);
    assert.equal(starts[0].options.model, 'grok-4.7');
    assert.ok(starts[0].content.startsWith('<agent_brief>'));
    assert.equal(stripAgentOnlyBlocks(starts[0].content), 'Перерисуй Pirelli');
    assert.equal((await call('POST', `/${agent.id}/chat`, { body: { task: ' ' } })).body.error.code, 'TASK_REQUIRED');

    assert.deepEqual((await call('GET', `/by-session/${sessionId}`)).body.data.agent, { id: agent.id, name: 'Художник' });
    assert.equal((await call('GET', `/by-session/${foreignChat}`)).body.data.agent, null);
    assert.equal((await call('GET', '/by-session/no-such-chat')).status, 404);

    assert.equal((await call('DELETE', `/${agent.id}`)).body.data.removed, true);
    assert.equal((await call('GET', `/${agent.id}`)).status, 404);
    assert.equal((await call('POST', `/${agent.id}/chat`, { body: { task: 'x' } })).body.error.code, 'AGENT_NOT_FOUND');
  });
});
