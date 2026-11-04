import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attachRunDurations } from '../services/run-duration.js';
import { answerHash } from '@/modules/database/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import type { RunDurationRow } from '@/modules/database/index.js';
import { sliceTailPage } from '@/shared/utils.js';
import { closeConnection, initializeDatabase, runDurationsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '../provider.registry.js';
import { sessionsService } from '../services/sessions.service.js';

const row = (id: string, time: number, content: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id, timestamp: new Date(time).toISOString(), sessionId: 's', provider: 'codex',
  kind: 'text', role: 'assistant', content, ...extra,
});
const timing = (start = 1000, finish = 136000, thinking: number | null = null): RunDurationRow => ({
  run_id: String(start), session_id: 's', started_at: start, finished_at: finish,
  duration_ms: finish - start, answer_hash: answerHash('Готово'), thinking_ms: thinking,
});

test('measured thinking rides with the duration; a run without thinking gets none', () => {
  const result = attachRunDurations([row('one', 135000, 'Готово'), row('two', 200000, 'Готово')],
    [timing(1000, 136000, 12000), timing(190000, 201000)]);
  assert.deepEqual(result.map(m => [m.completionDurationMs, m.thinkingDurationMs]),
    [[135000, 12000], [11000, undefined]]);
  assert.equal('thinkingDurationMs' in result[1], false);
});

test('measured duration attaches only to final answer, before pagination, without mutating history', () => {
  const messages = [row('old', 500, 'Готово'), row('progress', 2000, 'Проверяю'),
    row('final', 135000, 'Готово'), row('child', 135001, 'Готово', { parentToolUseId: 'agent' }),
    row('tool', 135002, 'Готово', { kind: 'tool_result' })];
  const result = attachRunDurations(messages, [timing()]);
  assert.deepEqual(result.map(m => m.completionDurationMs), [undefined, undefined, 135000, undefined, undefined]);
  assert.equal(messages[2].completionDurationMs, undefined);
  assert.equal(sliceTailPage(result, 2, 2).page[1].completionDurationMs, 135000);
  assert.equal(attachRunDurations(messages, [])[2].completionDurationMs, undefined);
});

test('repeated answers in separate real-clock runs retain their own timings', () => {
  const result = attachRunDurations([row('one', 135000, 'Готово'), row('two', 200000, 'Готово')],
    [timing(), timing(190000, 201000)]);
  assert.deepEqual(result.map(m => m.completionDurationMs), [135000, 11000]);
});

test('Grok synthetic timestamps never determine duration; ambiguous matches remain unlabelled', () => {
  const messages = [row('one', 1, 'Готово', { provider: 'grok' })];
  assert.equal(attachRunDurations(messages, [timing()])[0].completionDurationMs, 135000);
  assert.equal(attachRunDurations([...messages, row('two', 2, 'Готово', { provider: 'grok' })], [timing()])[0].completionDurationMs, undefined);
  assert.equal(attachRunDurations(messages, [timing(), timing(190000, 201000)])[0].completionDurationMs, undefined);
});

test('history service restores saved duration after reconnect and preserves pagination and session isolation', async (t) => {
  const previousPath = process.env.DATABASE_PATH;
  const scratch = await mkdtemp(path.join(tmpdir(), 'duration-history-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(scratch, 'auth.db');
  t.after(async () => {
    closeConnection();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    await rm(scratch, { recursive: true, force: true });
  });
  await initializeDatabase();
  sessionsDb.createAppSession('duration-history', 'codex', '/workspace/demo');
  sessionsDb.assignProviderSessionId('duration-history', 'native-history');
  runDurationsDb.save({ ...timing(), session_id: 'duration-history' });
  closeConnection();
  const history = [row('prompt', 1000, 'Сделай', { role: 'user' }), row('progress', 2000, 'Проверяю'), row('final', 135000, 'Готово')];
  t.mock.method(providerRegistry.resolveProvider('codex').sessions, 'fetchHistory', async () => ({
    messages: history, total: 3, hasMore: false, offset: 0, limit: null,
  }));
  const result = await sessionsService.fetchHistory('duration-history', { limit: 1 });
  assert.equal(result.total, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].sessionId, 'duration-history');
  assert.equal(result.messages[0].completionDurationMs, 135000);
  const older = await sessionsService.fetchHistory('duration-history', { limit: 1, offset: 1 });
  assert.equal(older.messages[0].id, 'progress');
  assert.equal(older.messages[0].completionDurationMs, undefined);
  assert.deepEqual(runDurationsDb.list('another-session'), []);
  closeConnection();
});

test('a thinking block the adapter did not show (empty text, signature only) is still a thinking moment', async () => {
  const { carriesUnshownThinking } = await import('../services/run-duration.js');
  const claudeLine = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }] } };
  assert.equal(carriesUnshownThinking(claudeLine, []), true);
  assert.equal(carriesUnshownThinking({ type: 'assistant', message: { content: [{ type: 'redacted_thinking', data: 'x' }] } }, []), true);
  // Already shown as a thinking row — no second marker.
  assert.equal(carriesUnshownThinking(claudeLine, [row('t', 1, 'мысль', { kind: 'thinking' })]), false);
  assert.equal(carriesUnshownThinking({ type: 'assistant', message: { content: [{ type: 'text', text: 'Готово' }] } }, []), false);
  assert.equal(carriesUnshownThinking({ type: 'user', message: { content: [{ type: 'thinking', thinking: '' }] } }, []), false);
  assert.equal(carriesUnshownThinking(null, []), false);
  // Grok reasoning lines with an empty summary (encrypted content only).
  assert.equal(carriesUnshownThinking({ type: 'reasoning', summary: [], encrypted_content: 'x' }, []), true);
  assert.equal(carriesUnshownThinking({ type: 'reasoning', summary: [{ text: 'мысль' }] }, [row('t', 1, 'мысль', { kind: 'thinking' })]), false);
});
