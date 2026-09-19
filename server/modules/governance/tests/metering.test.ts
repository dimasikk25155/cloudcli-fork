import assert from 'node:assert/strict';
import test from 'node:test';

import { RunMeter } from '@/modules/governance/metering.js';

// Contract test, not a mock test.
//
// The fixtures below are the real shape the Claude SDK streams: an assistant
// message carrying `message.usage` with the `cache_creation` TTL split, and a
// terminal `result` frame that repeats the same usage. The previous generation
// of this codebase shipped a bug for months because its tests asserted against
// a hand-written stub instead of the real envelope — the mock was more honest
// than reality, and 337 tests stayed green while unattended runs reported
// success with empty output.

function assistantMessage(overrides: {
  id: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
}) {
  return {
    type: 'assistant',
    message: {
      id: overrides.id,
      model: overrides.model ?? 'claude-sonnet-5',
      usage: {
        input_tokens: overrides.input ?? 0,
        output_tokens: overrides.output ?? 0,
        cache_read_input_tokens: overrides.cacheRead ?? 0,
        cache_creation: {
          ephemeral_5m_input_tokens: overrides.cacheWrite5m ?? 0,
          ephemeral_1h_input_tokens: overrides.cacheWrite1h ?? 0,
        },
      },
    },
  };
}

test('a message without usage contributes nothing', () => {
  const meter = new RunMeter();

  assert.equal(meter.addMessage({ type: 'system', subtype: 'init' }), false);
  assert.equal(meter.addMessage(null), false);
  assert.equal(meter.addMessage({ type: 'assistant', message: { id: 'a', content: [] } }), false);
  assert.equal(meter.isEmpty(), true);
  assert.equal(meter.finish().costMicroUsd, 0);
});

test('usage is summed across steps', () => {
  const meter = new RunMeter();

  meter.addMessage(assistantMessage({ id: 'msg-1', input: 1_000, output: 100 }));
  meter.addMessage(assistantMessage({ id: 'msg-2', input: 500, output: 50 }));

  const cost = meter.finish();
  assert.equal(cost.breakdown.inputTokens, 1_500);
  assert.equal(cost.breakdown.outputTokens, 150);
});

// The trap this class exists for: `result` frames repeat the last assistant
// usage. Counting both bills the final step twice.
test('a repeated message id is counted once', () => {
  const meter = new RunMeter();

  meter.addMessage(assistantMessage({ id: 'msg-1', input: 1_000, output: 100 }));
  const repeated = meter.addMessage(assistantMessage({ id: 'msg-1', input: 1_000, output: 100 }));

  assert.equal(repeated, false);
  assert.equal(meter.finish().breakdown.inputTokens, 1_000);
});

test('the cache_creation TTL split is read, not flattened', () => {
  const meter = new RunMeter();

  meter.addMessage(assistantMessage({ id: 'msg-1', cacheWrite5m: 2_000, cacheWrite1h: 3_000 }));

  const cost = meter.finish();
  assert.equal(cost.breakdown.cacheWrite5mTokens, 2_000);
  assert.equal(cost.breakdown.cacheWrite1hTokens, 3_000);
});

test('the older flat cache_creation_input_tokens shape still counts', () => {
  const meter = new RunMeter();

  meter.addMessage({
    type: 'assistant',
    message: {
      id: 'legacy',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 700 },
    },
  });

  const cost = meter.finish();
  assert.equal(cost.breakdown.cacheWrite5mTokens, 700, 'legacy writes bill at the 5-minute rate');
  assert.equal(cost.breakdown.cacheWrite1hTokens, 0);
});

// The expensive mistake: charging cache reads as fresh input. At Sonnet 5
// rates ($2/M in) 1M cache-read tokens cost $0.20, not $2.00.
test('cache reads bill at a tenth of fresh input', () => {
  const fresh = new RunMeter();
  fresh.addMessage(assistantMessage({ id: 'a', input: 1_000_000 }));

  const cached = new RunMeter();
  cached.addMessage(assistantMessage({ id: 'b', cacheRead: 1_000_000 }));

  const freshCost = fresh.finish().costUsd ?? 0;
  const cachedCost = cached.finish().costUsd ?? 0;

  assert.ok(Math.abs(freshCost - 2) < 1e-6, `expected $2.00 for fresh input, got ${freshCost}`);
  assert.ok(Math.abs(cachedCost - 0.2) < 1e-6, `expected $0.20 for cache reads, got ${cachedCost}`);
});

test('an engine with no published rates records tokens but no price', () => {
  const meter = new RunMeter();

  meter.addMessage(assistantMessage({ id: 'msg-1', model: 'k3', input: 1_000, output: 100 }));

  const cost = meter.finish();
  assert.equal(cost.costUsd, null, 'an invented price would be worse than none');
  assert.equal(cost.costMicroUsd, 0);
  assert.equal(cost.breakdown.inputTokens, 1_000, 'tokens are still recorded');
  assert.equal(cost.model, 'k3');
});

test('Grok native inclusive input does not bill cache as fresh input', () => {
  const meter = new RunMeter();
  meter.addMessage({
    type: 'result',
    model: 'grok-4.6-build',
    usage: {
      inputTokens: 2_871_452,
      outputTokens: 43_404,
      cachedReadTokens: 2_665_856,
    },
  });

  const cost = meter.finish();
  assert.equal(cost.breakdown.inputTokens, 2_871_452 - 2_665_856);
  assert.equal(cost.breakdown.cacheReadTokens, 2_665_856);
  assert.equal(cost.breakdown.outputTokens, 43_404);
  assert.ok(cost.costUsd !== null && cost.costUsd > 0);
  // Fresh $0.41 + cache $1.33 + output $0.26 ≈ $2.00, not $6+ if cache billed as fresh.
  assert.ok((cost.costUsd ?? 0) < 3, `got ${cost.costUsd}`);
});

test('micro-USD is an integer', () => {
  const meter = new RunMeter();
  meter.addMessage(assistantMessage({ id: 'msg-1', input: 1_234, output: 567 }));

  const { costMicroUsd } = meter.finish();
  assert.equal(Number.isInteger(costMicroUsd), true);
  assert.ok(costMicroUsd > 0);
});
