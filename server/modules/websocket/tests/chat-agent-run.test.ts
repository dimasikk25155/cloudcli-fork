import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { createAgentRunControl } from '@/modules/websocket/services/chat-websocket.service.js';
import { clientIdentities } from '@/modules/websocket/services/project-access.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

// «Агенты»: the first message of a chat with an agent is an ordinary run —
// registry, indicator, Stop, «Ждут тебя» — started without a socket for the
// admin who owns the agent, only in a chat that belongs to his agent.

type Fixture = { admin: number; member: number; otherAdmin: number };

async function withWorld(runTest: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-agent-run-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const otherAdmin = Number(userDb.createUserWithRole('second', 'x', 'admin').id);
    const member = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const project = projectsDb.createProjectPath('/workspace/agent-run').project!;
    userProjectAccessDb.grantAccess(member, project.project_id, admin);
    agentsDb.create({
      id: 'artist', userId: admin, name: 'Художник', role: 'r', checks: '', provider: 'grok', model: 'grok-4.7', effort: null, projectPath: project.project_path, files: [],
    });
    agentsDb.create({
      id: 'member-agent', userId: member, name: 'Помощник', role: 'r', checks: '', provider: 'grok', model: 'grok-4.7', effort: null, projectPath: project.project_path, files: [],
    });
    sessionsDb.createAppSession('agent-chat', 'grok', project.project_path);
    sessionsDb.createAppSession('member-agent-chat', 'grok', project.project_path);
    sessionsDb.createAppSession('plain-chat', 'grok', project.project_path);
    agentsDb.linkSession('agent-chat', 'artist', admin);
    agentsDb.linkSession('member-agent-chat', 'member-agent', member);
    await runTest({ admin, member, otherAdmin });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function fakeDependencies(modsOff: Set<string> = new Set()) {
  const spawns: Array<{ command: string; options: Record<string, unknown> }> = [];
  const dependencies = {
    userJailFor: () => null,
    spawnFns: {
      grok: async (command: string, options: Record<string, unknown>) => {
        spawns.push({ command, options });
        await new Promise(() => {});
      },
    },
    abortFns: {},
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    isModOn: (_userId: unknown, key: string) => !modsOff.has(key),
  } as unknown as Parameters<typeof createAgentRunControl>[0];
  return { dependencies, spawns };
}

test('the agent chat starts for its admin, is registered, and the engine gets the content and the agent model', async () => {
  await withWorld(({ admin }) => {
    const { dependencies, spawns } = fakeDependencies();
    const control = createAgentRunControl(dependencies);
    const started = control.start({
      sessionId: 'agent-chat', userId: admin, content: '<agent_brief>роль</agent_brief>\n\nПерерисуй', options: { model: 'grok-4.7', effort: 'high' },
    });
    assert.equal(started, true);
    assert.equal(chatRunRegistry.isProcessing('agent-chat'), true);
    assert.equal(spawns.length, 1);
    assert.match(spawns[0].command, /Перерисуй/);
    assert.equal(spawns[0].options.model, 'grok-4.7');
    assert.equal(spawns[0].options.effort, 'high');
    assert.equal(control.start({ sessionId: 'agent-chat', userId: admin, content: 'ещё', options: {} }), false, 'a busy chat is not started twice');
  });
});

test('refused: a chat without an agent, another admin\'s agent chat, a teammate, «Агенты» off', async () => {
  await withWorld(({ admin, member, otherAdmin }) => {
    const { dependencies, spawns } = fakeDependencies();
    const control = createAgentRunControl(dependencies);
    assert.equal(control.start({ sessionId: 'plain-chat', userId: admin, content: 'x', options: {} }), false);
    assert.equal(control.start({ sessionId: 'agent-chat', userId: otherAdmin, content: 'x', options: {} }), false);
    assert.equal(control.start({ sessionId: 'member-agent-chat', userId: member, content: 'x', options: {} }), false);

    const off = fakeDependencies(new Set(['modAgents']));
    assert.equal(createAgentRunControl(off.dependencies).start({ sessionId: 'agent-chat', userId: admin, content: 'x', options: {} }), false);
    assert.equal(spawns.length + off.spawns.length, 0);
    assert.equal(chatRunRegistry.isProcessing('agent-chat'), false);
  });
});

test('the live sidebar card of a chat of an agent carries agentName next to links; other chats none', async () => {
  await withWorld(async ({ admin }) => {
    const frames: Array<{ kind?: string; sessionId?: string; session?: { agentName?: string; links?: unknown } }> = [];
    const socket = { readyState: 1, send: (payload: string) => { frames.push(JSON.parse(payload)); } };
    clientIdentities.set(socket as never, { id: admin, role: 'admin' } as never);
    connectedClients.add(socket as never);
    chatRunRegistry.broadcastSessionUpsert('agent-chat');
    chatRunRegistry.broadcastSessionUpsert('plain-chat');
    for (let attempt = 0; attempt < 50 && frames.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const card = (id: string) => frames.find((frame) => frame.kind === 'session_upserted' && frame.sessionId === id);
    assert.equal(card('agent-chat')?.session?.agentName, 'Художник');
    assert.ok(card('agent-chat')?.session?.links);
    assert.ok(card('plain-chat'), 'the plain chat card arrived');
    assert.equal(card('plain-chat')?.session?.agentName, undefined);
  });
});
