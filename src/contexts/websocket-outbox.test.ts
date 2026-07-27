import assert from 'node:assert/strict';
import test from 'node:test';

import { WebSocketOutbox } from './websocket-outbox.js';

test('a frame queued while the socket was down is replayed on flush', () => {
  const outbox = new WebSocketOutbox();
  const sent: unknown[] = [];

  // The regression: attaching a photo on mobile backgrounds the page, the
  // socket dies, and this chat.send used to be dropped silently.
  outbox.push({ type: 'chat.send', content: 'смотри фото' }, 1_000);
  outbox.flush((frame) => sent.push(frame), 2_000);

  assert.deepEqual(sent, [{ type: 'chat.send', content: 'смотри фото' }]);
  assert.equal(outbox.size, 0);
});

test('frames replay in the order they were composed', () => {
  const outbox = new WebSocketOutbox();
  const sent: unknown[] = [];

  outbox.push('first', 1_000);
  outbox.push('second', 1_100);
  outbox.flush((frame) => sent.push(frame), 1_200);

  assert.deepEqual(sent, ['first', 'second']);
});

test('a frame older than the TTL is dropped instead of fired late', () => {
  const outbox = new WebSocketOutbox(60_000);
  const sent: unknown[] = [];

  outbox.push('stale', 0);
  outbox.push('fresh', 60_000);
  outbox.flush((frame) => sent.push(frame), 61_000);

  assert.deepEqual(sent, ['fresh']);
});

test('flushing twice does not send the same frame again', () => {
  const outbox = new WebSocketOutbox();
  const sent: unknown[] = [];

  outbox.push('once', 1_000);
  outbox.flush((frame) => sent.push(frame), 1_100);
  outbox.flush((frame) => sent.push(frame), 1_200);

  assert.deepEqual(sent, ['once']);
});
