import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../shared/types.js';
import { createIdeaCollector, extractImprovementIdeas } from '../idea-parser.js';

test('extracts only suggestion body, excluding signature and following blocks', () => {
  assert.deepEqual(extractImprovementIdeas('Ответ\n\n💡 **Что можно улучшить дальше:** сохранить выбор.\nПродолжение идеи.\n🕐 2026-11-02 03:18 МСК · ✉️ #4'), ['сохранить выбор.\nПродолжение идеи.']);
  assert.deepEqual(extractImprovementIdeas('Не предложение'), []);
});

test('collector handles deltas and snapshot without losing suggestions to tool traffic', async () => {
  const { createIdeaCollector } = await import('../idea-parser.js');
  const collector = createIdeaCollector();
  collector.event({ kind: 'stream_delta', id: 'a', content: '💡 Что можно улучшить ' });
  collector.event({ kind: 'stream_delta', id: 'a', content: 'дальше: Кэшировать каталог.\n🕐 дата' });
  collector.event({ kind: 'text', id: 'a', role: 'assistant', content: '💡 Что можно улучшить дальше: Кэшировать каталог.\n🕐 дата' });
  for (let i = 0; i < 6000; i++) collector.event({ kind: 'tool_use' });
  for (let i = 0; i < 200; i++) collector.event({ kind: 'text', id: `progress-${i}`, content: 'Работаю' });
  assert.deepEqual(collector.texts().flatMap(extractImprovementIdeas), ['Кэшировать каталог.']);
});

const frame = (kind: NormalizedMessage['kind'], content?: string, id: string = kind): NormalizedMessage => ({
  id, kind, content, sessionId: 'source', provider: 'claude', timestamp: '2026-11-02T00:00:00Z', role: 'assistant',
});
test('normalized service traffic cannot save a partial credential-bearing assistant block', () => {
  const collector = createIdeaCollector();
  const prefix = '💡 Что можно улучшить дальше: Использовать https://sample';
  const suffix = ':sample@example.invalid';
  for (const event of [frame('stream_delta', prefix), { kind: 'background_tasks' }, frame('stream_delta', suffix), frame('stream_end'), frame('text', prefix + suffix, 'snapshot'), frame('complete')]) collector.event(event);
  assert.deepEqual(collector.texts().flatMap(extractImprovementIdeas), []);
});
test('snapshot with unrelated id replaces deltas, while service frames do not close the block', () => {
  const collector = createIdeaCollector();
  collector.event(frame('stream_delta', '💡 Что можно улучшить дальше: Кэш'));
  collector.event({ kind: 'background_tasks' });
  collector.event(frame('stream_delta', ' каталога.'));
  collector.event(frame('stream_end'));
  collector.event(frame('text', '💡 Что можно улучшить дальше: Кэш каталога.', 'snapshot'));
  collector.event(frame('complete'));
  assert.deepEqual(collector.texts().flatMap(extractImprovementIdeas), ['Кэш каталога.']);
});
test('overflow discards a truncated block rather than extracting its surviving tail', () => {
  const collector = createIdeaCollector();
  collector.event(frame('stream_delta', 'x'.repeat(64_001)));
  collector.event(frame('stream_delta', '\n💡 Что можно улучшить дальше: Ошибочный хвост.'));
  collector.event(frame('complete'));
  assert.deepEqual(collector.texts().flatMap(extractImprovementIdeas), []);
});
test('secret detection covers the whole block before suggestion extraction', () => {
  const text = 'https://sample:sample@example.invalid\n💡 Что можно улучшить дальше: Кэш каталога.';
  assert.deepEqual(extractImprovementIdeas(text), []);
});
