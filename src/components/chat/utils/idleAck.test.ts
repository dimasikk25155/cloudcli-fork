import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyIdleAck,
  hasSeqGap,
  isStaleIdleAck,
} from './idleAck.js';

test('completed_while_disconnected: local run, knownSeq=5, lastSeq=6 → refresh without warning', () => {
  const decision = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 5,
    serverLastSeq: 6,
  });

  assert.equal(decision.kind, 'completed_while_disconnected');
  assert.equal(decision.markIdle, true);
  assert.equal(decision.refreshHistory, true);
  assert.equal(decision.warnOrphaned, false);
});

test('completed_while_disconnected: reconnect before the first live event, knownSeq=0, lastSeq>0', () => {
  const decision = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 0,
    serverLastSeq: 4,
  });

  assert.equal(decision.kind, 'completed_while_disconnected');
  assert.equal(decision.warnOrphaned, false);
  assert.equal(decision.refreshHistory, true);
  assert.equal(hasSeqGap(0, 4), true);
});

test('orphaned: local run, lastSeq missing → keep the connection-lost warning', () => {
  const decision = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 5,
    serverLastSeq: null,
  });

  assert.equal(decision.kind, 'orphaned');
  assert.equal(decision.markIdle, true);
  assert.equal(decision.refreshHistory, false);
  assert.equal(decision.warnOrphaned, true);
});

test('orphaned: local run, lastSeq did not grow → keep the warning', () => {
  const missing = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 5,
  });
  const unchanged = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 5,
    serverLastSeq: 5,
  });
  const behind = classifyIdleAck({
    locallyProcessing: true,
    knownSeq: 5,
    serverLastSeq: 3,
  });

  assert.equal(missing.kind, 'orphaned');
  assert.equal(unchanged.kind, 'orphaned');
  assert.equal(behind.kind, 'orphaned');
  assert.equal(unchanged.warnOrphaned, true);
});

test('noop: ordinary idle without a local run → no messages', () => {
  const decision = classifyIdleAck({
    locallyProcessing: false,
    knownSeq: 5,
    serverLastSeq: 5,
  });

  assert.equal(decision.kind, 'noop');
  assert.equal(decision.markIdle, false);
  assert.equal(decision.refreshHistory, false);
  assert.equal(decision.warnOrphaned, false);
});

test('stale ack does not complete a newer request', () => {
  const decision = classifyIdleAck({
    locallyProcessing: true,
    ackIsStale: true,
    knownSeq: 5,
    serverLastSeq: 6,
  });

  assert.equal(decision.kind, 'noop');
  assert.equal(decision.markIdle, false);
  assert.equal(decision.refreshHistory, false);
  assert.equal(decision.warnOrphaned, false);
  assert.equal(isStaleIdleAck(2_000, 1_000), true);
  assert.equal(isStaleIdleAck(1_000, 1_000), true);
  assert.equal(isStaleIdleAck(900, 1_000), false);
});

test('refresh_gap: idle locally but the server seq is ahead', () => {
  const decision = classifyIdleAck({
    locallyProcessing: false,
    knownSeq: 5,
    serverLastSeq: 8,
  });

  assert.equal(decision.kind, 'refresh_gap');
  assert.equal(decision.markIdle, false);
  assert.equal(decision.refreshHistory, true);
  assert.equal(decision.warnOrphaned, false);
});
