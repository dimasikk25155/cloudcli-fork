import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Codex } from '@openai/codex-sdk';

import { closeConnection, initializeDatabase, sessionsDb, uiPreferencesDb, userDb } from './modules/database/index.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { chatRunRegistry } from './modules/websocket/services/chat-run-registry.service.js';
import { getCodexBackgroundTasks, queryCodex, stopCodexTask } from './openai-codex.js';

// «Фон: N» in a Codex chat, end to end without Codex: the SDK stream replays
// the live fixture (a real rollout's timeline, see
// providers/tests/codex-background-tasks.test.ts) and the run goes through
// the registry writer a chat uses. «Пульт фона» off — no frames.

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules/providers/tests/fixtures/codex-background-live.jsonl');
const A = 'exec-9835e7b9-d403-49d9-8132-6fbc4ad540eb';
const B = 'exec-6b53f6b1-8184-42d5-aaf0-00a12689c746';
const C = 'exec-bf845d6a-d2cb-4e09-835b-40ea634878ee';

class FakeConnection {
  readyState = 1;
  frames = [];
  send(data) {
    this.frames.push(JSON.parse(data));
  }
}

test('a Codex run sends its background commands as «Фон» frames — only to a user with the console on', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-background-run-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const events = (await readFile(FIXTURE, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const seenMidRun = [];
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: { DEFAULT: 'fixture', OPTIONS: [] } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async () => 'fixture');
  t.mock.method(providerModelsService, 'resolveResumeEffort', async () => undefined);
  t.mock.method(Codex.prototype, 'startThread', () => ({
    runStreamed: async () => ({ events: (async function* () {
      for (const event of events) {
        yield event;
        // While A runs in the background, the subscribe snapshot lists it and
        // «Стоп» finds no `codex exec` process here — no false «stopped».
        if (event.type === 'item.started' && event.item?.id === C) {
          seenMidRun.push(getCodexBackgroundTasks(events[0].thread_id).map((task) => task.taskId));
          seenMidRun.push(await stopCodexTask(events[0].thread_id, A));
        }
      }
    })() }),
  }));
  try {
    const on = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const off = Number(userDb.createUserWithRole('slava', 'x', 'user').id);
    uiPreferencesDb.updateUiPreferences(off, { modBackgroundConsole: false });
    const runFakeCodex = async (appSessionId, userId) => {
      sessionsDb.createAppSession(appSessionId, 'codex', directory);
      const connection = new FakeConnection();
      const run = chatRunRegistry.startRun({ appSessionId, provider: 'codex', providerSessionId: null, connection, userId });
      await queryCodex('покажи фон', { cwd: directory }, run.writer);
      return connection.frames;
    };

    const onFrames = await runFakeCodex('codex-bg-on', on);
    const lists = onFrames.filter((frame) => frame.kind === 'background_tasks');
    assert.ok(lists.every((frame) => frame.provider === 'codex' && frame.sessionId === 'codex-bg-on'));
    assert.deepEqual(lists.map((frame) => frame.tasks.map((task) => task.taskId)), [[A], [A, B], [A], [A, C], [A], []]);
    assert.ok(lists.every((frame) => frame.tasks.every((task) => task.stoppable === false)), 'no process found — no «Стоп» on any row');
    assert.deepEqual(seenMidRun, [[A], { ok: false, reason: 'unsupported' }]);
    assert.equal(onFrames.at(-1)?.kind, 'complete');
    assert.deepEqual(getCodexBackgroundTasks(events[0].thread_id), [], 'the list is gone with the turn');
    assert.deepEqual(await stopCodexTask(events[0].thread_id, A), { ok: false, reason: 'turn_ended' });

    const offFrames = await runFakeCodex('codex-bg-off', off);
    assert.equal(offFrames.filter((frame) => frame.kind === 'background_tasks').length, 0);
    assert.equal(offFrames.at(-1)?.kind, 'complete');
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
