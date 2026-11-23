import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStreamingMessage } from './streamingMessage.js';

const base = { sessionId: 's1', provider: 'grok' as const };

test('the first portion takes the time the server stamped on it, not the browser clock', () => {
  const msg = buildStreamingMessage({
    ...base, text: 'Привет', existing: undefined, serverTimestamp: '2026-11-23T19:02:10.000Z', now: () => '2026-11-23T19:49:54.000Z',
  });
  assert.equal(msg.timestamp, '2026-11-23T19:02:10.000Z');
  assert.equal(msg.id, '__streaming_s1');
  assert.equal(msg.kind, 'stream_delta');
});

test('later flushes keep the time of the bubble, so it never drifts to «now»', () => {
  const first = buildStreamingMessage({ ...base, text: 'a', existing: undefined, serverTimestamp: '2026-11-23T19:02:10.000Z', now: () => 'X' });
  const second = buildStreamingMessage({ ...base, text: 'ab', existing: first, serverTimestamp: undefined, now: () => '2026-11-23T19:49:54.000Z' });
  assert.equal(second.timestamp, '2026-11-23T19:02:10.000Z');
  assert.equal(second.content, 'ab');
});

test('without any server time the old behaviour stays: the browser clock', () => {
  const msg = buildStreamingMessage({ ...base, text: 'a', existing: undefined, serverTimestamp: undefined, now: () => '2026-11-23T19:49:54.000Z' });
  assert.equal(msg.timestamp, '2026-11-23T19:49:54.000Z');
});

test('a malformed server time is ignored', () => {
  const msg = buildStreamingMessage({ ...base, text: 'a', existing: undefined, serverTimestamp: 'not a date', now: () => '2026-11-23T19:49:54.000Z' });
  assert.equal(msg.timestamp, '2026-11-23T19:49:54.000Z');
});
