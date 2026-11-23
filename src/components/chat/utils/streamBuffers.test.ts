import assert from 'node:assert/strict';
import test from 'node:test';

import { createStreamBuffers, shouldHandleSubscribedAck } from './streamBuffers.js';

/** Manual timers: nothing fires until the test says so. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    schedule: (fn: () => void) => {
      const handle = next++;
      pending.set(handle, fn);
      return handle;
    },
    cancel: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fireAll: () => {
      const due = [...pending.values()];
      pending.clear();
      due.forEach((fn) => fn());
    },
    get size() {
      return pending.size;
    },
  };
}

test('deltas of two chats streaming at once never mix', () => {
  const timers = manualTimers();
  const buffers = createStreamBuffers({ schedule: timers.schedule, cancel: timers.cancel });
  const flushed: Array<[string, string]> = [];
  const onFlush = (sessionId: string, text: string) => flushed.push([sessionId, text]);

  buffers.append('A', 'Привет', onFlush);
  buffers.append('B', 'Hello', onFlush);
  buffers.append('A', ', мир', onFlush);
  buffers.append('B', ' world', onFlush);
  timers.fireAll();

  assert.deepEqual(flushed.sort(), [['A', 'Привет, мир'], ['B', 'Hello world']]);
});

test('complete of chat B takes only B: A keeps its text and its pending flush', () => {
  const timers = manualTimers();
  const buffers = createStreamBuffers({ schedule: timers.schedule, cancel: timers.cancel });
  const flushed: Array<[string, string]> = [];
  const onFlush = (sessionId: string, text: string) => flushed.push([sessionId, text]);

  buffers.append('A', 'начало ответа A', onFlush);
  buffers.append('B', 'ответ B', onFlush);

  assert.equal(buffers.take('B'), 'ответ B');
  assert.equal(buffers.take('B'), '');
  assert.equal(timers.size, 1, 'only A still waits for its flush');

  timers.fireAll();
  assert.deepEqual(flushed, [['A', 'начало ответа A']]);
  assert.equal(buffers.take('A'), 'начало ответа A');
});

test('reset of one session leaves the others; reset without an id clears all', () => {
  const timers = manualTimers();
  const buffers = createStreamBuffers({ schedule: timers.schedule, cancel: timers.cancel });
  const noop = () => undefined;
  buffers.append('A', 'a', noop);
  buffers.append('B', 'b', noop);
  buffers.reset('A');
  assert.equal(buffers.take('A'), '');
  assert.equal(buffers.take('B'), 'b');

  buffers.append('A', 'a', noop);
  buffers.append('B', 'b', noop);
  buffers.reset();
  assert.equal(timers.size, 0);
  assert.equal(buffers.take('A'), '');
  assert.equal(buffers.take('B'), '');
});

test('a chat_subscribed ack is handled only for a session this chat subscribed to', () => {
  const sentAt = new Map<string, number>([['mine', 1_000]]);
  assert.equal(shouldHandleSubscribedAck(sentAt, 'mine'), true);
  // The other chat on the page subscribed to this one — not ours to act on.
  assert.equal(shouldHandleSubscribedAck(sentAt, 'other-chat'), false);
  assert.equal(shouldHandleSubscribedAck(sentAt, null), false);
});

test('the flush carries the time of the FIRST portion, not of the latest one', () => {
  const timers = manualTimers();
  const buffers = createStreamBuffers({ schedule: timers.schedule, cancel: timers.cancel });
  const flushed: Array<[string, string, string | undefined]> = [];
  const onFlush = (sessionId: string, text: string, startedAt?: string) => flushed.push([sessionId, text, startedAt]);

  buffers.append('A', 'Прив', onFlush, '2026-11-23T19:02:10.000Z');
  buffers.append('A', 'ет', onFlush, '2026-11-23T19:49:25.000Z');
  timers.fireAll();

  assert.deepEqual(flushed, [['A', 'Привет', '2026-11-23T19:02:10.000Z']]);
});

test('a frame without a time leaves the start unknown, and the next buffer starts clean', () => {
  const timers = manualTimers();
  const buffers = createStreamBuffers({ schedule: timers.schedule, cancel: timers.cancel });
  const starts: Array<string | undefined> = [];
  const onFlush = (_sessionId: string, _text: string, startedAt?: string) => starts.push(startedAt);

  buffers.append('A', 'x', onFlush);
  assert.equal(buffers.startedAt('A'), undefined);
  buffers.take('A');

  buffers.append('A', 'y', onFlush, '2026-11-23T20:00:00.000Z');
  assert.equal(buffers.startedAt('A'), '2026-11-23T20:00:00.000Z');
  buffers.take('A');
  assert.equal(buffers.startedAt('A'), undefined);
  timers.fireAll();
  assert.deepEqual(starts, []);
});
