import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb, uiPreferencesDb, userDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { createAutoRelayRunControl } from '@/modules/websocket/services/chat-websocket.service.js';

// «Фон: N» for Codex goes the same way as Claude's and Grok's: the runtime
// sends `background_tasks {provider:'codex'}`, the gateway stamps
// `stoppable` from stopTaskFns, each row keeps its own «Стоп» flag (process
// found or not), and «Пульт фона» switched off drops the frame.

test('codex background_tasks reach the chat with the engine and row flags; «Пульт фона» off drops them', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-bg-codex-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const owner = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const muted = Number(userDb.createUserWithRole('quiet', 'x', 'admin').id);
    uiPreferencesDb.updateUiPreferences(muted, { modBackgroundConsole: false });
    const project = projectsDb.createProjectPath('/workspace/bg-codex').project!;
    for (const id of ['codex-on', 'codex-nostop', 'codex-off']) sessionsDb.createAppSession(id, 'codex', project.project_path);

    const tasks = [
      { taskId: 'exec-1', kind: 'bash', description: 'npm run dev', startedAt: 1, toolUseId: 'exec-1', stoppable: true },
      { taskId: 'exec-2', kind: 'bash', description: 'tail -f log', startedAt: 2, toolUseId: 'exec-2', stoppable: false },
    ];
    const spawn = async (_command: string, _options: unknown, writer: { send: (m: unknown) => void }) => {
      writer.send({ kind: 'background_tasks', provider: 'codex', sessionId: 'thread-native', tasks });
      await new Promise(() => {});
    };
    const base = {
      spawnFns: { codex: spawn },
      abortFns: {},
      backgroundTasksFns: {},
      resolveToolApproval: () => {},
      getPendingApprovalsForSession: () => [],
    };
    const withStop = createAutoRelayRunControl({ ...base, stopTaskFns: { codex: async () => ({ ok: true }) } } as unknown as Parameters<typeof createAutoRelayRunControl>[0]);
    const withoutStop = createAutoRelayRunControl({ ...base, stopTaskFns: {} } as unknown as Parameters<typeof createAutoRelayRunControl>[0]);

    const framesOf = async (control: typeof withStop, sessionId: string, userId: number) => {
      assert.equal(control.start({ sessionId, userId, parentSessionId: sessionId, content: 'x', options: {} }), true);
      await new Promise((resolve) => setImmediate(resolve));
      return chatRunRegistry.replayEvents(sessionId, 0).filter((event) => (event.kind as string) === 'background_tasks') as unknown as Array<Record<string, unknown>>;
    };

    const [on] = await framesOf(withStop, 'codex-on', owner);
    assert.equal(on.provider, 'codex');
    assert.equal(on.stoppable, true);
    assert.deepEqual((on.tasks as Array<{ taskId: string; stoppable: boolean }>).map((task) => [task.taskId, task.stoppable]),
      [['exec-1', true], ['exec-2', false]]);

    const [noStop] = await framesOf(withoutStop, 'codex-nostop', owner);
    assert.equal(noStop.stoppable, false, 'no registered stop — no «Стоп» for any row');

    assert.deepEqual(await framesOf(withStop, 'codex-off', muted), []);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
