import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionsProvider, extractCodexResponseUserMessage } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';

const stamp = (second: number) => new Date(Date.UTC(2026, 8, 14, 7, 20, second)).toISOString();
const entry = (second: number, type: string, payload: object) => ({ timestamp: stamp(second), type, payload });
const user = (second: number, text: string, turn: string) => entry(second, 'response_item', {
  type: 'message', id: `user-${turn}`, role: 'user', content: [{ type: 'input_text', text }],
  internal_chat_message_metadata_passthrough: { turn_id: turn, content_item_kinds: ['user.text'] },
});
const answer = (second: number, text: string) => entry(second, 'response_item', {
  type: 'message', id: `answer-${second}`, role: 'assistant', content: [{ type: 'output_text', text }],
});

test('Codex 0.153 history keeps real prompts, excludes injected user context, and reconciles live turns without F5', async () => {
  // Runtime-only cross-layer assertion: do not pull the browser's bundler-mode
  // source tree into the NodeNext server compilation.
  const mergeModule = '../../../../src/stores/sessionMessageMerge.ts';
  const { computeMerged, pruneRealtimeSupersededByServer } = await import(mergeModule);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neo3-codex-history-'));
  const previousPath = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    // Prevent legacy-db migration from copying an actual workspace database.
    await writeFile(process.env.DATABASE_PATH, '');
    await initializeDatabase();
    const transcript = path.join(directory, 'rollout.jsonl');
    const session = sessionsDb.createSession('codex-order-test', 'codex', directory, undefined, undefined, undefined, transcript);
    const provider = new CodexSessionsProvider();
    const rows: object[] = [entry(0, 'response_item', {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Injected AGENTS.md instructions' }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions'] },
    })];
    await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    let realtime: NormalizedMessage[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      // The same prompt in separate turns must never be mistaken for an echo.
      const prompt = 'так я не понял, мой впс потянет все эти проекты?';
      const local: NormalizedMessage = {
        id: `local_${turn}`, sessionId: session, provider: 'codex', kind: 'text', role: 'user',
        content: prompt, timestamp: stamp(turn * 20 - 10),
      };
      realtime.push(local);
      const beforeSend = (await provider.fetchHistory(session)).messages;
      assert.equal(computeMerged(beforeSend, realtime).at(-1)?.id, local.id,
        'a new prompt must follow the previous answer before disk catches up');

      const reply = `Ответ ${turn}: проверяю детали запроса и готовлю окончательный результат.`;
      const live: NormalizedMessage = {
        id: '__streaming_test', sessionId: session, provider: 'codex', kind: 'stream_delta',
        content: reply, timestamp: stamp(turn * 20 + 5),
      };
      realtime.push(live);
      rows.push(user(turn * 20, prompt, String(turn)), answer(turn * 20 + 2, reply.slice(0, 40)));
      await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      const partial = (await provider.fetchHistory(session)).messages;
      const duringStream = computeMerged(partial, realtime);
      assert.equal(duringStream.filter((row: NormalizedMessage) => row.role === 'user').length, turn);
      assert.equal(duringStream.at(-1)?.content, reply, 'a history prefix must not replace the growing live answer');
      assert.equal(duringStream.filter((row: NormalizedMessage) => row.content?.startsWith(`Ответ ${turn}:`)).length, 1);

      rows[rows.length - 1] = answer(turn * 20 + 5, reply);
      await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      const history = await provider.fetchHistory(session);
      const server = history.messages as NormalizedMessage[];
      assert.equal(server.filter((row) => row.role === 'user').length, turn);
      assert.ok(!server.some((row) => row.content?.includes('Injected AGENTS')));
      realtime = pruneRealtimeSupersededByServer(server, realtime);
      const merged = computeMerged(server, realtime);
      assert.deepEqual(merged.filter((row: NormalizedMessage) => row.kind === 'text').map((row: NormalizedMessage) => row.role),
        Array.from({ length: turn }, () => ['user', 'assistant']).flat());
      assert.equal(realtime.length, 0);
      assert.deepEqual((await provider.fetchHistory(session)).messages.map((row) => row.content), merged.map((row: NormalizedMessage) => row.content));
    }

    // Older event_msg transcripts remain supported.
    rows.push(entry(90, 'event_msg', { type: 'user_message', message: 'Legacy prompt' }), answer(95, 'Legacy answer'));
    await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    assert.deepEqual((await provider.fetchHistory(session)).messages.slice(-2).map((row) => row.content), ['Legacy prompt', 'Legacy answer']);
  } finally {
    closeConnection();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('modern Codex user images keep attachments but hide image transport and injected context', () => {
  const result = extractCodexResponseUserMessage({
    type: 'message', id: 'image-prompt', role: 'user',
    internal_chat_message_metadata_passthrough: {
      content_item_kinds: ['agents_md.instructions', 'user.text', 'user.image', 'user.text', 'user.text'],
    },
    content: [
      { type: 'input_text', text: 'Private injected instructions' },
      { type: 'input_text', text: '<image name=[Image #1] path="/tmp/shot.png">' },
      { type: 'input_image', image_url: 'data:image/png;base64,abc' },
      { type: 'input_text', text: '</image>' },
      { type: 'input_text', text: 'ну вот письмо\n<images_input>\ntransport\n</images_input>' },
    ],
  });
  assert.equal(result?.message.content, 'ну вот письмо');
  assert.deepEqual(result?.images, [{ path: '/tmp/shot.png' }]);
  assert.equal(extractCodexResponseUserMessage({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AGENTS.md' }] }), null);
});
