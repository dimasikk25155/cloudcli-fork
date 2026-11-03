import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompletionDuration } from './completionDuration.js';
import { normalizedToChatMessages } from '../hooks/useChatMessages.js';

test('completed durations cover seconds, minutes, hours, and invalid values', () => {
  for (const [ms, expected] of [[0, '0 сек'], [40000, '40 сек'], [60000, '1 мин 0 сек'],
    [135000, '2 мин 15 сек'], [3661000, '1 ч 1 мин 1 сек'], [-1, null], [NaN, null], [Infinity, null]] as const) {
    assert.equal(formatCompletionDuration(ms), expected);
  }
});

test('history normalization retains measured duration only on ordinary assistant text', () => {
  const base = { id: 'a', sessionId: 's', provider: 'codex' as const,
    timestamp: '2026-11-02T13:00:00Z', completionDurationMs: 135000, content: 'Готово' };
  const messages = normalizedToChatMessages([
    { ...base, kind: 'text', role: 'assistant' },
    { ...base, kind: 'text', role: 'user' },
    { ...base, kind: 'stream_delta' },
    { ...base, kind: 'thinking' },
  ]);
  assert.deepEqual(messages.map(m => m.completionDurationMs), [135000, undefined, undefined, undefined]);
});
