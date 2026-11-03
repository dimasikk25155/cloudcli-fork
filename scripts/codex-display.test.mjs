import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';

import { closeConnection, initializeDatabase, sessionsDb } from '../server/modules/database/index.js';
import { providerModelsService } from '../server/modules/providers/services/provider-models.service.js';
import { chatRunRegistry } from '../server/modules/websocket/services/chat-run-registry.service.js';
import { queryCodex } from '../server/openai-codex.js';
import { computeMerged, pruneRealtimeSupersededByServer } from '../src/stores/sessionMessageMerge.js';
import { normalizedToChatMessages } from '../src/components/chat/hooks/useChatMessages.js';

test('Codex repeated native item ids survive two turns, reconnect replay and history hydration', async (t) => {
  // Run through the isolated test runner: never open the production database.
  const testHome = process.env.HOME || '';
  assert.match(path.basename(testHome), /^(cloudcli-test-db-|neo3-display-tests-)/);
  assert.ok(process.env.DATABASE_PATH && path.resolve(process.env.DATABASE_PATH).startsWith(path.resolve(testHome) + path.sep));
  await initializeDatabase();
  const sessionId = 'codex-display-fixture';
  const nativeId = 'codex-native-fixture';
  sessionsDb.createAppSession(sessionId, 'codex', '/fixture');
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: { DEFAULT: 'fixture', OPTIONS: [] } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async () => 'fixture');
  t.mock.method(providerModelsService, 'resolveResumeEffort', async () => undefined);
  let marker = '';
  const thread = () => ({ runStreamed: async () => ({ events: (async function* () {
    yield { type: 'thread.started', thread_id: nativeId };
    yield { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: marker } };
    yield { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } };
  })() }) });
  t.mock.method(Codex.prototype, 'startThread', thread);
  t.mock.method(Codex.prototype, 'resumeThread', thread);
  const markers = ['DISPLAY_FIRST_7f31', 'DISPLAY_SECOND_98c2'];
  let live = [];
  const history = [];
  const answerIds = [];
  let previousWriter;
  try {
    for (const [index, expected] of markers.entries()) {
      marker = expected;
      const user = { id: `local_prompt_${index}`, sessionId, provider: 'codex',
        kind: 'text', role: 'user', content: `Request ${index}`, timestamp: new Date().toISOString() };
      live.push(user);
      live = pruneRealtimeSupersededByServer(history, live);
      history.push({ ...user, id: `disk_prompt_${index}` });
      live = pruneRealtimeSupersededByServer(history, live);
      const frames = [];
      const connection = { readyState: 1, send(data) { frames.push(JSON.parse(data)); } };
      const run = chatRunRegistry.startRun({ appSessionId: sessionId, provider: 'codex',
        providerSessionId: index ? nativeId : null, connection, userId: null });
      assert.ok(run);
      // A late old writer must not insert an old answer into the new turn.
      previousWriter?.send({ kind: 'text', provider: 'codex', content: 'STALE_MARKER', role: 'assistant' });
      await queryCodex(`Request ${index}`, index ? { sessionId: nativeId } : {}, run.writer);
      assert.equal(frames.filter(row => row.kind === 'complete').length, 1);
      const answers = frames.filter(row => row.kind === 'text' && row.role === 'assistant');
      assert.deepEqual(answers.map(row => row.content), [expected]);
      assert.ok(frames.every(row => row.sessionId === sessionId));
      answerIds.push(answers[0].id);
      // Re-deliver the same frames, as can happen during reconnect.
      const replay = chatRunRegistry.replayEvents(sessionId, 0);
      assert.deepEqual(replay.filter(row => row.kind === 'text').map(row => row.content), [expected]);
      live.push(...answers, ...replay.filter(row => row.kind === 'text'));
      const visible = normalizedToChatMessages(computeMerged(history, live));
      assert.deepEqual(visible.filter(row => row.type === 'assistant').map(row => row.content), markers.slice(0, index + 1));
      history.push({ ...answers[0], id: `disk_answer_${index}` });
      live = pruneRealtimeSupersededByServer(history, live);
      const hydrated = normalizedToChatMessages(computeMerged(history, live));
      assert.deepEqual(hydrated.filter(row => row.type === 'assistant').map(row => row.content), markers.slice(0, index + 1));
      previousWriter = run.writer;
    }
    assert.notEqual(answerIds[0], answerIds[1]);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
  }
});
