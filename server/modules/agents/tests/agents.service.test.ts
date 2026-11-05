import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  agentsDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { createAgentsService } from '@/modules/agents/index.js';
import type { AgentRunStart } from '@/modules/agents/index.js';

import { stripAgentOnlyBlocks } from '../../../../shared/agent-only-blocks.js';

// Stories 2, 2a, 3, 4, 5, 6, 21: agents with a role, checks, engine, folder,
// knowledge files and versioned memory; a chat with an agent starts on the
// server with the hidden role block.

type World = {
  service: ReturnType<typeof createAgentsService>;
  starts: AgentRunStart[];
  runStarts: { ok: boolean };
  admin: number;
  member: number;
  project: string;
  foreignProject: string;
  outside: string;
};

const CATALOG: Record<string, Array<{ value: string; efforts: string[] }>> = {
  claude: [{ value: 'opus[1m]', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { value: 'sonnet[1m]', efforts: [] }, { value: 'fable', efforts: [] }],
  grok: [{ value: 'grok-4.7', efforts: [] }, { value: 'grok-4.7-build-fast', efforts: [] }],
  codex: [{ value: 'gpt-6-sol', efforts: ['low', 'high'] }, { value: 'gpt-6-astra', efforts: [] }, { value: 'gpt-5-mini', efforts: [] }],
};

async function withWorld(run: (world: World) => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'agents-service-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
    const member = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
    const projectDir = path.join(directory, 'tyres');
    const outside = path.join(directory, 'outside');
    await mkdir(path.join(projectDir, 'docs'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(projectDir, 'docs', 'style.md'), '# стиль');
    await writeFile(path.join(projectDir, 'labels.md'), '# этикетки');
    await writeFile(path.join(outside, 'secret.md'), 'чужое');
    await symlink(path.join(outside, 'secret.md'), path.join(projectDir, 'docs', 'link.md'));
    const project = projectsDb.createProjectPath(projectDir).project!.project_path;
    const foreignProject = path.join(directory, 'not-registered');
    await mkdir(foreignProject);

    const starts: AgentRunStart[] = [];
    const runStarts = { ok: true };
    let chatNumber = 0;
    const service = createAgentsService({
      listModels: async (provider) => CATALOG[provider] ?? [],
      createSession: (provider, projectPath) => {
        chatNumber += 1;
        const sessionId = `chat-${chatNumber}`;
        sessionsDb.createAppSession(sessionId, provider, projectPath);
        return { sessionId };
      },
      broadcastUpsert: () => {},
    });
    service.setRunControl({
      start(input) {
        starts.push(input);
        return runStarts.ok;
      },
    });
    await run({ service, starts, runStarts, admin, member, project, foreignProject, outside });
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function refused(promise: Promise<unknown> | (() => unknown), code: string): Promise<void> {
  await assert.rejects(async () => (typeof promise === 'function' ? promise() : promise), (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });
}

function artist(project: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'Художник',
    role: 'Перерисовываешь карточки шин.',
    checks: 'Сверь размер на этикетке.',
    provider: 'grok',
    model: 'grok-4.7',
    projectPath: project,
    files: ['docs/style.md', path.join(project, 'labels.md')],
    ...extra,
  };
}

test('create: the agent is saved with its engine, folder and files (absolute paths) and listed', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const created = await service.create(admin, artist(project));
    assert.equal(created.name, 'Художник');
    assert.equal(created.provider, 'grok');
    assert.equal(created.model, 'grok-4.7');
    assert.equal(created.effort, null);
    assert.equal(created.projectPath, project);
    assert.deepEqual(created.files, [path.join(project, 'docs', 'style.md'), path.join(project, 'labels.md')]);
    assert.equal(created.rulesVersion, 0);
    assert.deepEqual(service.list(admin).map((agent) => agent.id), [created.id]);
    assert.equal(service.get(admin, created.id).role, 'Перерисовываешь карточки шин.');
  });
});

test('create: no model → the engine default; effort is checked against the catalog', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const claude = await service.create(admin, artist(project, { name: 'Критик', provider: 'claude', model: '', effort: 'high' }));
    assert.equal(claude.model, 'opus[1m]');
    assert.equal(claude.effort, 'high');
    const codex = await service.create(admin, artist(project, { name: 'Счетовод', provider: 'codex', model: undefined, effort: 'default' }));
    assert.equal(codex.model, 'gpt-6-sol');
    assert.equal(codex.effort, null);
    await refused(service.create(admin, artist(project, { name: 'Другой', provider: 'claude', model: 'opus[1m]', effort: 'turbo' })), 'EFFORT_NOT_ALLOWED');
  });
});

test('create: the name is 1–40 characters and unique per user without case, Cyrillic included', async () => {
  await withWorld(async ({ service, admin, project }) => {
    await service.create(admin, artist(project));
    await refused(service.create(admin, artist(project, { name: 'ХУДОЖНИК' })), 'AGENT_NAME_TAKEN');
    await refused(service.create(admin, artist(project, { name: '   ' })), 'NAME_INVALID');
    await refused(service.create(admin, artist(project, { name: 'x'.repeat(41) })), 'NAME_INVALID');
    await refused(service.create(admin, artist(project, { name: 'два\nимени' })), 'NAME_INVALID');
    assert.ok(await service.create(admin, artist(project, { name: 'x'.repeat(40) })));
  });
});

test('create: role 1–8000, checks up to 2000', async () => {
  await withWorld(async ({ service, admin, project }) => {
    await refused(service.create(admin, artist(project, { role: '' })), 'ROLE_INVALID');
    await refused(service.create(admin, artist(project, { role: 'р'.repeat(8001) })), 'ROLE_INVALID');
    await refused(service.create(admin, artist(project, { checks: 'п'.repeat(2001) })), 'CHECKS_TOO_LONG');
    assert.ok(await service.create(admin, artist(project, { role: 'р'.repeat(8000), checks: 'п'.repeat(2000) })));
  });
});

test('create: only claude, codex or grok, and only models the policy allows', async () => {
  await withWorld(async ({ service, admin, project }) => {
    await refused(service.create(admin, artist(project, { provider: 'cursor' })), 'PROVIDER_NOT_ALLOWED');
    await refused(service.create(admin, artist(project, { provider: 'grok', model: 'grok-3' })), 'MODEL_NOT_ALLOWED');
    await refused(service.create(admin, artist(project, { provider: 'codex', model: 'gpt-5-mini' })), 'MODEL_NOT_ALLOWED');
    await refused(service.create(admin, artist(project, { provider: 'claude', model: 'haiku' })), 'MODEL_NOT_ALLOWED');
  });
});

test('create: the folder must be a registered project', async () => {
  await withWorld(async ({ service, admin, project, foreignProject }) => {
    await refused(service.create(admin, artist(project, { projectPath: foreignProject, files: [] })), 'PROJECT_NOT_FOUND');
    await refused(service.create(admin, artist(project, { projectPath: '' })), 'PROJECT_NOT_FOUND');
  });
});

test('create: files only inside the folder — «..», an outside path, a symlink out, a missing file, more than 20 are refused', async () => {
  await withWorld(async ({ service, admin, project, outside }) => {
    await refused(service.create(admin, artist(project, { files: ['../outside/secret.md'] })), 'FILE_OUTSIDE_PROJECT');
    await refused(service.create(admin, artist(project, { files: ['docs/../labels.md'] })), 'FILE_OUTSIDE_PROJECT');
    await refused(service.create(admin, artist(project, { files: [path.join(outside, 'secret.md')] })), 'FILE_OUTSIDE_PROJECT');
    await refused(service.create(admin, artist(project, { files: ['docs/link.md'] })), 'FILE_OUTSIDE_PROJECT');
    await refused(service.create(admin, artist(project, { files: ['docs/missing.md'] })), 'FILE_NOT_FOUND');
    await refused(service.create(admin, artist(project, { files: ['docs'] })), 'FILE_NOT_FOUND');
    await refused(service.create(admin, artist(project, { files: Array.from({ length: 21 }, () => 'labels.md') })), 'TOO_MANY_FILES');
  });
});

test('update: changes stick, are validated again, the name stays unique; remove deletes the agent', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const first = await service.create(admin, artist(project));
    const second = await service.create(admin, artist(project, { name: 'Критик' }));
    const updated = await service.update(admin, first.id, { role: 'Новая роль', provider: 'claude', files: [] });
    assert.equal(updated.role, 'Новая роль');
    assert.equal(updated.provider, 'claude');
    assert.equal(updated.model, 'opus[1m]', 'a model of the old engine is replaced by the new engine default');
    assert.deepEqual(updated.files, []);
    assert.equal(service.get(admin, first.id).role, 'Новая роль');
    await refused(service.update(admin, second.id, { name: 'художник' }), 'AGENT_NAME_TAKEN');
    await refused(service.update(admin, second.id, { files: ['../x'] }), 'FILE_OUTSIDE_PROJECT');
    assert.equal((await service.update(admin, first.id, { name: 'ХУДОЖНИК' })).name, 'ХУДОЖНИК', 'renaming itself by case is fine');

    service.remove(admin, first.id);
    await refused(() => service.get(admin, first.id), 'AGENT_NOT_FOUND');
    await refused(() => service.remove(admin, first.id), 'AGENT_NOT_FOUND');
  });
});

test('memory: every add or removal is the next version; history shows each version; the brief carries the live rules', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const agent = await service.create(admin, artist(project));
    assert.equal(service.addRule(admin, agent.id, 'До 4 переделок', 'user').version, 1);
    const afterSecond = service.addRule(admin, agent.id, 'Не писать CDEK на этикетке', 'agent');
    assert.equal(afterSecond.version, 2);
    const firstRuleId = afterSecond.rules[0].id;
    const afterRemove = service.removeRule(admin, agent.id, firstRuleId);
    assert.equal(afterRemove.version, 3);
    assert.deepEqual(afterRemove.rules.map((rule) => rule.text), ['Не писать CDEK на этикетке']);
    assert.deepEqual(afterRemove.history, [
      { version: 3, removed: 'До 4 переделок' },
      { version: 2, added: 'Не писать CDEK на этикетке', by: 'agent' },
      { version: 1, added: 'До 4 переделок', by: 'user' },
    ]);
    assert.equal(service.get(admin, agent.id).rulesVersion, 3);

    const brief = service.briefFor(admin, agent.id);
    assert.ok(brief.includes('Правила (V3):'));
    assert.ok(brief.includes('1. Не писать CDEK на этикетке'));
    assert.ok(!brief.includes('До 4 переделок'));
    assert.ok(brief.includes('Сверь размер на этикетке.'));
    assert.ok(brief.includes(path.join(project, 'labels.md')));

    await refused(() => service.removeRule(admin, agent.id, firstRuleId), 'RULE_NOT_FOUND');
    await refused(() => service.addRule(admin, agent.id, '  ', 'user'), 'RULE_INVALID');
    await refused(() => service.addRule(admin, agent.id, 'п'.repeat(501), 'user'), 'RULE_INVALID');
  });
});

test('memory: at most 50 live rules', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const agent = await service.create(admin, artist(project));
    for (let index = 1; index <= 50; index += 1) service.addRule(admin, agent.id, `Правило ${index}`, 'user');
    await refused(() => service.addRule(admin, agent.id, 'Пятьдесят первое', 'agent'), 'RULE_LIMIT');
  });
});

test('findByName ignores case; agents of another user are invisible', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const agent = await service.create(admin, artist(project));
    assert.equal(service.findByName(admin, 'художник')?.id, agent.id);
    assert.equal(service.findByName(admin, 'Критик'), null);
    const otherAdmin = Number(userDb.createUserWithRole('second', 'unused', 'admin').id);
    assert.equal(service.findByName(otherAdmin, 'Художник'), null);
    await refused(() => service.get(otherAdmin, agent.id), 'AGENT_NOT_FOUND');
  });
});

test('a teammate has no agents: every action is refused', async () => {
  await withWorld(async ({ service, admin, member, project }) => {
    const agent = await service.create(admin, artist(project));
    await refused(() => service.list(member), 'ADMIN_ONLY');
    await refused(service.create(member, artist(project, { name: 'Мой' })), 'ADMIN_ONLY');
    await refused(() => service.findByName(member, 'Художник'), 'ADMIN_ONLY');
    await refused(service.startChat(member, agent.id, 'задача'), 'ADMIN_ONLY');
  });
});

test('startChat: an ordinary chat of the folder on the agent engine, named after the agent, started with the hidden role', async () => {
  await withWorld(async ({ service, starts, admin, project }) => {
    const agent = await service.create(admin, artist(project, { provider: 'claude', model: 'sonnet[1m]', effort: null }));
    service.addRule(admin, agent.id, 'До 4 переделок', 'user');
    const { sessionId } = await service.startChat(admin, agent.id, 'Перерисуй карточку Pirelli P Zero 205/55 R16 в фирменном стиле магазина\nподробности ниже');

    const session = sessionsDb.getSessionById(sessionId)!;
    assert.equal(session.provider, 'claude');
    assert.equal(session.project_path, project);
    assert.equal(session.model, 'sonnet[1m]');
    assert.ok(session.custom_name?.startsWith('Художник: Перерисуй карточку Pirelli'));
    assert.ok((session.custom_name ?? '').length <= 60);
    assert.deepEqual(service.agentOfSession(sessionId), { id: agent.id, name: 'Художник' });

    assert.equal(starts.length, 1);
    assert.equal(starts[0].sessionId, sessionId);
    assert.equal(starts[0].userId, admin);
    assert.deepEqual(starts[0].options, { model: 'sonnet[1m]', projectPath: project });
    assert.match(starts[0].content, /^<agent_brief>\n[\s\S]*Правила \(V1\):\n1\. До 4 переделок[\s\S]*<\/agent_brief>\n\n/);
    assert.equal(stripAgentOnlyBlocks(starts[0].content), 'Перерисуй карточку Pirelli P Zero 205/55 R16 в фирменном стиле магазина\nподробности ниже');
  });
});

test('startChat: effort of the agent rides along; an empty task is refused; a run that did not start leaves no chat behind', async () => {
  await withWorld(async ({ service, starts, runStarts, admin, project }) => {
    const agent = await service.create(admin, artist(project, { provider: 'claude', model: 'opus[1m]', effort: 'max' }));
    await refused(service.startChat(admin, agent.id, '   '), 'TASK_REQUIRED');

    const { sessionId } = await service.startChat(admin, agent.id, 'задача');
    assert.equal(starts[0].options.effort, 'max');
    assert.equal(sessionsDb.getSessionById(sessionId)?.effort, 'max');

    runStarts.ok = false;
    await refused(service.startChat(admin, agent.id, 'ещё задача'), 'RUN_NOT_STARTED');
    assert.equal(starts.length, 2);
    const failedId = starts[1].sessionId;
    assert.equal(sessionsDb.getSessionById(failedId), null);
    assert.equal(agentsDb.agentOfSession(failedId), null);
  });
});

test('agentOfSession: null for an ordinary chat and after the agent is removed', async () => {
  await withWorld(async ({ service, admin, project }) => {
    const agent = await service.create(admin, artist(project));
    const { sessionId } = await service.startChat(admin, agent.id, 'задача');
    assert.equal(service.agentOfSession('no-such-chat'), null);
    service.remove(admin, agent.id);
    assert.equal(service.agentOfSession(sessionId), null);
  });
});
