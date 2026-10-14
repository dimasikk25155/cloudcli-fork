import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionLinksDb,
  sessionsDb,
  sessionThreadsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { threadTokens } from '@/modules/threads/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { createThreadRunControl } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

// Decision 6: a thread run is an ordinary registered run started without a
// socket, on behalf of the parent's user, only for the parent itself or one
// of its threads — and it carries its own thread token in the runtime options.

type Fixture = { owner: number; outsider: number; projectPath: string };

async function withWorld(runTest: (fixture: Fixture) => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-thread-run-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const owner = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const outsider = Number(userDb.createUserWithRole('guest', 'x', 'user').id);
    const project = projectsDb.createProjectPath('/workspace/thread-run').project!;
    userProjectAccessDb.grantAccess(owner, project.project_id, admin);
    sessionsDb.createAppSession('parent', 'claude', project.project_path);
    sessionsDb.createAppSession('thread', 'grok', project.project_path);
    sessionsDb.createAppSession('unrelated', 'grok', project.project_path);
    sessionLinksDb.setParent('thread', 'parent', 'thread');
    await runTest({ owner, outsider, projectPath: project.project_path });
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
  const aborted: string[] = [];
  const dependencies = {
    spawnFns: {
      grok: async (command: string, options: Record<string, unknown>) => {
        spawns.push({ command, options });
        await new Promise(() => {});
      },
      claude: async (command: string, options: Record<string, unknown>) => {
        spawns.push({ command, options });
        await new Promise(() => {});
      },
    },
    abortFns: {
      grok: (providerSessionId: string) => { aborted.push(providerSessionId); return true; },
    },
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    isModOn: (_userId: unknown, key: string) => !modsOff.has(key),
  } as unknown as Parameters<typeof createThreadRunControl>[0];
  return { dependencies, spawns, aborted };
}

test('a thread run starts as the parent user, is registered, and carries its own thread token', async () => {
  await withWorld(({ owner }) => {
    const { dependencies, spawns } = fakeDependencies();
    const control = createThreadRunControl(dependencies);

    assert.equal(control.start({ sessionId: 'thread', userId: owner, parentSessionId: 'parent', content: 'Проверь тесты', options: { model: 'grok-4.7-build-fast' } }), true);
    assert.equal(chatRunRegistry.isProcessing('thread'), true);
    assert.equal(spawns.length, 1);
    assert.match(spawns[0].command, /Проверь тесты/);
    assert.equal(spawns[0].options.model, 'grok-4.7-build-fast');

    const env = spawns[0].options.threadsEnv as { NEO3_THREADS_TOKEN: string; NEO3_THREADS_API_URL: string };
    assert.match(env.NEO3_THREADS_API_URL, /^http:\/\/[^/]+:\d+\/api\/threads$/);
    assert.deepEqual(threadTokens.resolve(env.NEO3_THREADS_TOKEN), { sessionId: 'thread', userId: owner, permissionMode: null });
  });
});

test('the parent itself may be started («Треды готовы»), a busy chat may not', async () => {
  await withWorld(({ owner }) => {
    const { dependencies } = fakeDependencies();
    const control = createThreadRunControl(dependencies);
    assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'Треды готовы', options: {} }), true);
    assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'ещё раз', options: {} }), false);
  });
});

test('a chat that is not a thread of that parent, or a user without access, is refused', async () => {
  await withWorld(({ owner, outsider }) => {
    const { dependencies, spawns } = fakeDependencies();
    const control = createThreadRunControl(dependencies);
    assert.equal(control.start({ sessionId: 'unrelated', userId: owner, parentSessionId: 'parent', content: 'x', options: {} }), false);
    assert.equal(control.start({ sessionId: 'thread', userId: outsider, parentSessionId: 'parent', content: 'x', options: {} }), false);
    assert.equal(spawns.length, 0);
    assert.equal(chatRunRegistry.isProcessing('unrelated'), false);
  });
});

test('abort stops a running thread like the Stop button and reports an idle one', async () => {
  await withWorld(async ({ owner }) => {
    const { dependencies } = fakeDependencies();
    const control = createThreadRunControl(dependencies);
    control.start({ sessionId: 'thread', userId: owner, parentSessionId: 'parent', content: 'x', options: {} });
    assert.equal(await control.abort('thread', owner), true);
    assert.equal(chatRunRegistry.isProcessing('thread'), false);
    assert.equal(await control.abort('thread', owner), false);
  });
});

test('threads switched off, chat without threads: the run gets no thread token, only the «threads are off» marker', async () => {
  await withWorld(({ owner }) => {
    const { dependencies, spawns } = fakeDependencies(new Set(['modThreads']));
    const control = createThreadRunControl(dependencies);

    assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'Продолжай', options: {} }), true);
    assert.deepEqual(spawns[0].options.threadsEnv, { NEO3_THREADS_OFF: '1' });
  });
});

test('threads switched off, chat that already has threads: a token to follow and stop them, plus the marker', async () => {
  await withWorld(({ owner }) => {
    sessionThreadsDb.insert({
      thread_session_id: 'thread',
      parent_session_id: 'parent',
      user_id: owner,
      provider: 'grok',
      model: 'grok-4.7-build-fast',
      permission_mode: null,
      created_at: '2026-10-14T10:00:00.000Z',
      started_at: '2026-10-14T10:00:00.000Z',
      seen_at: null,
      notified_at: null,
    } as Parameters<typeof sessionThreadsDb.insert>[0]);
    const { dependencies, spawns } = fakeDependencies(new Set(['modThreads']));
    const control = createThreadRunControl(dependencies);

    assert.equal(control.start({ sessionId: 'parent', userId: owner, parentSessionId: 'parent', content: 'Что с тредами?', options: {} }), true);
    const env = spawns[0].options.threadsEnv as Record<string, string>;
    assert.equal(env.NEO3_THREADS_OFF, '1');
    assert.deepEqual(threadTokens.resolve(env.NEO3_THREADS_TOKEN), { sessionId: 'parent', userId: owner, permissionMode: null });
  });
});
