import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from './claude-sdk.js';

// R29 (spec story 43): every Claude CLI Neo3 spawns carries NEO3_SESSION=1, so
// the user-level Stop hook (vault reminder) and the CLI secret guard can step
// aside inside Neo3 while staying active in a plain terminal.

const effortModels = { OPTIONS: [], DEFAULT: 'opus[1m]' };

test('the Claude subprocess env carries NEO3_SESSION=1', () => {
  const { env } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
  assert.equal(env.NEO3_SESSION, '1');
});

test('the marker survives the engine branches that rewrite the env (local model)', () => {
  const { env } = mapCliOptionsToSDK({ model: 'local-qwen35-9b', effortModels });
  assert.equal(env.NEO3_SESSION, '1');
});

test('the host env is still forwarded alongside the marker', () => {
  const previous = process.env.NEO3_TEST_PASSTHROUGH;
  process.env.NEO3_TEST_PASSTHROUGH = 'kept';
  try {
    const { env } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
    assert.equal(env.NEO3_TEST_PASSTHROUGH, 'kept');
    assert.equal(env.NEO3_SESSION, '1');
  } finally {
    if (previous === undefined) delete process.env.NEO3_TEST_PASSTHROUGH;
    else process.env.NEO3_TEST_PASSTHROUGH = previous;
  }
});
