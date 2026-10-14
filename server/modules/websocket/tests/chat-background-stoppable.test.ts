import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { createAutoRelayRunControl } from '@/modules/websocket/services/chat-websocket.service.js';

// Whether «Стоп» exists for a background task is the server's call: the
// `background_tasks` frame says `stoppable` when the run's engine has a stop
// (stopTaskFns). Claude has one, Grok does not.

test('background_tasks frames carry stoppable = the engine has a stop', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-bg-stoppable-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const owner = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const project = projectsDb.createProjectPath('/workspace/bg-stoppable').project!;
    sessionsDb.createAppSession('claude-chat', 'claude', project.project_path);
    sessionsDb.createAppSession('grok-chat', 'grok', project.project_path);
    const emitTasks = (provider: string) => async (_command: string, _options: unknown, writer: { send: (m: unknown) => void }) => {
      writer.send({ kind: 'background_tasks', provider, sessionId: `${provider}-native`, tasks: [{ taskId: 't1', kind: 'bash', description: 'npm run dev', startedAt: 1 }] });
      await new Promise(() => {});
    };
    const control = createAutoRelayRunControl({
      spawnFns: { claude: emitTasks('claude'), grok: emitTasks('grok') },
      abortFns: {},
      stopTaskFns: { claude: async () => ({ ok: true }) },
      backgroundTasksFns: {},
      resolveToolApproval: () => {},
      getPendingApprovalsForSession: () => [],
    } as unknown as Parameters<typeof createAutoRelayRunControl>[0]);

    for (const [sessionId, stoppable] of [['claude-chat', true], ['grok-chat', false]] as const) {
      assert.equal(control.start({ sessionId, userId: owner, parentSessionId: sessionId, content: 'x', options: {} }), true);
      await new Promise((resolve) => setImmediate(resolve));
      const frames = chatRunRegistry.replayEvents(sessionId, 0).filter((event) => (event.kind as string) === 'background_tasks');
      assert.equal(frames.length, 1, sessionId);
      assert.equal((frames[0] as { stoppable?: unknown }).stoppable, stoppable, sessionId);
    }
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
