import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLiveAnswerTimings, formatAnswerTiming, formatCompletionDuration } from './completionDuration.js';
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

test('answer timing reads «Думал N с · ответ за N с»; without thinking only the answer time', () => {
  assert.equal(formatAnswerTiming({ completionDurationMs: 63_000, thinkingDurationMs: 12_000 }), 'Думал 12 с · ответ за 1 мин 3 с');
  assert.equal(formatAnswerTiming({ completionDurationMs: 40_000 }), 'Ответ за 40 с');
  assert.equal(formatAnswerTiming({ completionDurationMs: 120_000, thinkingDurationMs: 300 }), 'Думал <1 с · ответ за 2 мин');
  assert.equal(formatAnswerTiming({ completionDurationMs: 3_725_000, thinkingDurationMs: 61_000 }), 'Думал 1 мин 1 с · ответ за 1 ч 2 мин 5 с');
  assert.equal(formatAnswerTiming({ completionDurationMs: Number.NaN, thinkingDurationMs: 1000 }), null);
  assert.equal(formatAnswerTiming({ thinkingDurationMs: 1000 }), null);
});

test('history normalization keeps measured thinking next to the duration', () => {
  const [message] = normalizedToChatMessages([{ id: 'a', sessionId: 's', provider: 'claude', kind: 'text', role: 'assistant',
    timestamp: '2026-11-04T10:00:00Z', content: 'Готово', completionDurationMs: 63_000, thinkingDurationMs: 12_000 }]);
  assert.equal(message.thinkingDurationMs, 12_000);
});

test('a live timing from the complete frame labels its answer until history brings its own', () => {
  const base = { sessionId: 's', provider: 'grok' as const, timestamp: '2026-11-04T10:00:00Z', kind: 'text' as const, role: 'assistant' as const };
  type Row = Omit<typeof base, 'role'> & { id: string; content: string; role: 'user' | 'assistant'; parentToolUseId?: string;
    completionDurationMs?: number; thinkingDurationMs?: number };
  const messages: Row[] = [
    { ...base, id: 'u', role: 'user' as const, content: 'Проверь' },
    { ...base, id: 'old', content: 'Готово' },
    { ...base, id: 'child', content: 'Готово', parentToolUseId: 'call-1' },
    { ...base, id: 'final', content: 'Готово  ' },
  ];
  const timings = [{ answer: 'Готово', completionDurationMs: 9_000, thinkingDurationMs: 2_000 }];
  const labelled = applyLiveAnswerTimings(messages, timings);
  assert.deepEqual(labelled.map((m) => m.completionDurationMs), [undefined, undefined, undefined, 9_000]);
  assert.equal(labelled[3].thinkingDurationMs, 2_000);
  assert.equal(messages[3].completionDurationMs, undefined, 'the input is not mutated');
  // History already measured it: the server value stays.
  const measured = applyLiveAnswerTimings([{ ...messages[3], completionDurationMs: 8_500 }], timings);
  assert.equal(measured[0].completionDurationMs, 8_500);
  assert.equal(applyLiveAnswerTimings(messages, []), messages);
});
