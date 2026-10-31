import assert from 'node:assert/strict';
import test from 'node:test';

import { RunMeter } from '@/modules/governance/index.js';

import { codexMeterMessage } from '../list/codex/codex-usage.js';

test('Codex usage counts cached tokens once and keeps unavailable pricing unknown', () => {
  const meter = new RunMeter();
  const row = codexMeterMessage({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 }, 'unknown-codex-model', 'turn');
  meter.addMessage(row);
  meter.addMessage(row);
  assert.deepEqual(meter.finish().breakdown, {
    inputTokens: 200, cacheReadTokens: 800, outputTokens: 50, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0,
  });
  assert.equal(meter.finish().costUsd, null);
});
