import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentsService } from '@/modules/agents/index.js';
import {
  agentsDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { createThreadsService, createThreadTokens, ThreadsError } from '@/modules/threads/index.js';
import type { ThreadRunStart } from '@/modules/threads/index.js';

import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks.js';

// Stories 7, 9, 20, 21: spawn_thread{agent} opens a helper with the agent's
// role, memory, engine and model; explicit provider/model win; unknown name →
// AGENT_NOT_FOUND with the names; mod off → MOD_OFF; limits stay.

type World = {
  service: ReturnType<typeof createThreadsService>;
  agents: ReturnType<typeof createAgentsService>;
  starts: ThreadRunStart[];
  running: Set<string>;
  modsOff: Set<string>;
  adminToken: string;
  memberToken: string;
  adminId: number;
  project: string;
};

const CATALOG = {
  claude: [{ value: 'opus[1m]', efforts: ['low', 'high'] }, { value: 'sonnet[1m]', efforts: [] }, { value: 'fable', efforts: [] }],
  grok: [{ value: 'grok-4.7', efforts: [] }, { value: 'grok-4.7-build-fast', efforts: [] }],
  codex: [{ value: 'gpt-6-sol', efforts: [] }],
} as Record<string, Array<{ value: string; efforts: string[] }>>;

async function withWorld(run: (world: World) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'threads-agent-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const adminId = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
    const memberId = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
    const project = projectsDb.createProjectPath(path.join(directory, 'tyres')).project!;
    userProjectAccessDb.grantAccess(memberId, project.project_id, adminId);
    const tokens = createThreadTokens({});
    const starts: ThreadRunStart[] = [];
    const running = new Set<string>();
    const modsOff = new Set<string>();
    const agents = createAgentsService({ listModels: async (provider) => CATALOG[provider] ?? [], broadcastUpsert: () => {} });
    const service = createThreadsService({
      tokens,
      isProcessing: (sessionId) => running.has(sessionId),
      attentionOf: () => null,
      fetchMessages: async () => [],
      checkClaudeLimit: async () => ({ blocked: false }),
      listModels: async () => [],
      broadcastUpsert: () => {},
      isModOn: (_userId, key) => !modsOff.has(key),
      agents,
    });
    service.setRunControl({
      start: (input) => { starts.push(input); running.add(input.sessionId); return true; },
      abort: async () => true,
    });
    sessionsDb.createAppSession('shtab', 'claude', project.project_path);
    sessionsDb.createAppSession('shtab-member', 'claude', project.project_path);
    await run({
      service, agents, starts, running, modsOff, adminId, project: project.project_path,
      adminToken: tokens.issue({ sessionId: 'shtab', userId: adminId })!,
      memberToken: tokens.issue({ sessionId: 'shtab-member', userId: memberId })!,
    });
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function refused(promise: Promise<unknown>, code: string): Promise<ThreadsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ThreadsError, `expected ThreadsError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  return assert.fail(`expected refusal ${code}`);
}

const critic = (project: string) => ({
  name: 'Критик', role: 'Ищешь слабые места в ставках.', checks: 'Пересчитай цифры.',
  provider: 'claude', model: 'sonnet[1m]', effort: 'high', projectPath: project,
});

test('spawn_thread{agent}: the thread runs on the agent engine and model with its hidden brief and title', async () => {
  await withWorld(async (world) => {
    const agent = await world.agents.create(world.adminId, critic(world.project));
    world.agents.addRule(world.adminId, agent.id, 'Не округляй коэффициенты', 'user');
    const result = await world.service.spawnThread(world.adminToken, { agent: 'критик', prompt: 'Разбери ставку №3' });

    assert.equal(result.provider, 'claude');
    assert.equal(result.model, 'sonnet[1m]');
    assert.equal(sessionsDb.getSessionById(result.threadId)?.provider, 'claude');
    assert.ok(result.title.startsWith('Критик: '), result.title);
    const start = world.starts[0];
    assert.equal(start.options.model, 'sonnet[1m]');
    assert.equal(start.options.effort, 'high');
    assert.match(start.content, /^<agent_brief>/);
    assert.match(start.content, /Ищешь слабые места/);
    assert.match(start.content, /Не округляй коэффициенты/);
    assert.equal(stripAgentOnlyBlocks(start.content).trim(), 'Разбери ставку №3');
    assert.deepEqual(agentsDb.agentOfSession(result.threadId)?.name, 'Критик');
  });
});

test('spawn_thread{agent}: explicit provider and model beat the agent; the agent effort is not carried to another engine', async () => {
  await withWorld(async (world) => {
    await world.agents.create(world.adminId, critic(world.project));
    const sameEngine = await world.service.spawnThread(world.adminToken, { agent: 'Критик', prompt: 'a', model: 'fable' });
    assert.equal(sameEngine.model, 'fable');
    const other = await world.service.spawnThread(world.adminToken, { agent: 'Критик', prompt: 'b', provider: 'grok' });
    assert.equal(other.provider, 'grok');
    assert.equal(other.model, 'grok-4.7-build-fast');
    assert.equal(world.starts[1].options.effort, undefined);
  });
});

test('spawn_thread{agent}: an unknown name is AGENT_NOT_FOUND with the list of names; nothing is created', async () => {
  await withWorld(async (world) => {
    await world.agents.create(world.adminId, critic(world.project));
    const error = await refused(world.service.spawnThread(world.adminToken, { agent: 'Призрак', prompt: 'x' }), 'AGENT_NOT_FOUND');
    assert.equal(error.status, 404);
    assert.match(error.message, /Критик/);
    assert.equal(world.starts.length, 0);
  });
});

test('spawn_thread{agent}: «Агенты» off → MOD_OFF; a thread without agent still opens', async () => {
  await withWorld(async (world) => {
    await world.agents.create(world.adminId, critic(world.project));
    world.modsOff.add('modAgents');
    await refused(world.service.spawnThread(world.adminToken, { agent: 'Критик', prompt: 'x' }), 'MOD_OFF');
    const plain = await world.service.spawnThread(world.adminToken, { prompt: 'без агента' });
    assert.equal(plain.provider, 'grok');
  });
});

test('spawn_thread{agent}: a non-admin cannot call agents', async () => {
  await withWorld(async (world) => {
    await world.agents.create(world.adminId, critic(world.project));
    await refused(world.service.spawnThread(world.memberToken, { agent: 'Критик', prompt: 'x' }), 'ADMIN_ONLY');
    assert.equal(world.starts.length, 0);
  });
});

test('spawn_thread{agent}: the limit of 3 and the ban on nesting stay', async () => {
  await withWorld(async (world) => {
    await world.agents.create(world.adminId, critic(world.project));
    for (let index = 0; index < 3; index += 1) {
      await world.service.spawnThread(world.adminToken, { agent: 'Критик', prompt: `задача ${index}` });
    }
    await refused(world.service.spawnThread(world.adminToken, { agent: 'Критик', prompt: 'четвёртая' }), 'THREAD_LIMIT');
  });
});
