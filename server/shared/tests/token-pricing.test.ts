import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_BREAKDOWN,
  estimateCostUsd,
  getContextWindow,
  isPricedModel,
  readCacheCreationSplit,
  readUsageBreakdown,
} from '@/shared/token-pricing.js';

const MILLION = 1_000_000;

test('context window comes from the model, not a global constant', () => {
  // The old hardcoded 160000 understated a 1M model by 6x, which made the
  // composer badge unreadable as a fill level.
  assert.equal(getContextWindow('claude-opus-5'), 1_000_000);
  assert.equal(getContextWindow('claude-sonnet-5'), 1_000_000);
  assert.equal(getContextWindow('claude-haiku-4-5'), 200_000);
});

test('provider-prefixed model ids still resolve to a window', () => {
  assert.equal(getContextWindow('us.anthropic.claude-opus-5'), 1_000_000);
  assert.equal(getContextWindow('anthropic.claude-sonnet-5'), 1_000_000);
});

test('an unknown window is reported as unknown, not as a wrong 200K', () => {
  // Defaulting to 200K used to render a normal 222K turn on a 1M model as a
  // red "111%". Zero means "no denominator" and the badge shows the count only.
  assert.equal(getContextWindow('some-future-model'), 0);
  assert.equal(getContextWindow(null), 0);
  assert.equal(getContextWindow(''), 0);
});

test('picker aliases resolve instead of collapsing to no window', () => {
  // Catalog values are what the model picker stores; they are not API ids.
  assert.equal(getContextWindow('opus[1m]'), 1_000_000);
  assert.equal(getContextWindow('sonnet[1m]'), 1_000_000);
  assert.equal(getContextWindow('fable'), 1_000_000);
  assert.equal(getContextWindow('haiku'), 200_000);
});

test('the [1m] suffix wins even on a model the table does not know', () => {
  // The suffix *is* the 1M-context variant, whichever model carries it.
  assert.equal(getContextWindow('some-future-model[1m]'), 1_000_000);
});

test('longest matching prefix wins so 4-5 does not shadow 4-6', () => {
  assert.equal(getContextWindow('claude-opus-4-6'), 1_000_000);
  assert.equal(getContextWindow('claude-opus-4-5'), 200_000);
});

test('cache read is billed at a tenth of fresh input', () => {
  const fresh = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, inputTokens: MILLION },
    'claude-opus-5',
  );
  const cached = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, cacheReadTokens: MILLION },
    'claude-opus-5',
  );

  assert.equal(fresh?.totalUsd, 5);
  assert.equal(cached?.totalUsd, 0.5);
});

test('cache writes price by TTL: 1.25x for 5m, 2x for 1h', () => {
  const fiveMin = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, cacheWrite5mTokens: MILLION },
    'claude-opus-5',
  );
  const oneHour = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, cacheWrite1hTokens: MILLION },
    'claude-opus-5',
  );

  assert.equal(fiveMin?.totalUsd, 6.25);
  assert.equal(oneHour?.totalUsd, 10);
});

test('output carries the output rate, not the input rate', () => {
  const estimate = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, outputTokens: MILLION },
    'claude-opus-5',
  );
  assert.equal(estimate?.totalUsd, 25);
});

test('a realistic agent turn is dominated by cheap cache reads', () => {
  // Shape of a real measured day: ~97% cache read. Billing the whole volume at
  // the fresh-input rate would overstate the cost by roughly 10x.
  const estimate = estimateCostUsd(
    {
      inputTokens: 46_000,
      outputTokens: 1_200_000,
      cacheReadTokens: 337_000_000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 7_500_000,
    },
    'claude-opus-5',
  );

  assert.ok(estimate);
  // 0.23 + 30 + 168.5 + 75 = 273.73
  assert.ok(Math.abs(estimate.totalUsd - 273.73) < 0.01, `got ${estimate.totalUsd}`);
  const naive = (46_000 + 1_200_000 + 337_000_000 + 7_500_000) * (5 / MILLION);
  assert.ok(naive > estimate.totalUsd * 6, 'naive per-token math should be far higher');
});

test('fast mode switches to premium Opus rates', () => {
  const standard = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, outputTokens: MILLION },
    'claude-opus-5',
  );
  const fast = estimateCostUsd(
    { ...EMPTY_BREAKDOWN, outputTokens: MILLION },
    'claude-opus-5',
    { speed: 'fast' },
  );

  assert.equal(standard?.totalUsd, 25);
  assert.equal(fast?.totalUsd, 50);
});

test('models without published rates return null rather than a guess', () => {
  assert.equal(isPricedModel('claude-opus-5'), true);
  assert.equal(isPricedModel('k3'), false);
  assert.equal(estimateCostUsd({ ...EMPTY_BREAKDOWN, inputTokens: MILLION }, 'k3'), null);
  assert.equal(estimateCostUsd({ ...EMPTY_BREAKDOWN, inputTokens: MILLION }, null), null);
  // ...but an unpriced model still reports a usable context window.
  assert.equal(getContextWindow('k3'), 256_000);
});

test('Grok 4.6 uses published xAI API rates, including the $0.50 cache read', () => {
  assert.equal(isPricedModel('grok-4.6-build'), true);
  assert.equal(getContextWindow('grok-4.6-build'), 500_000);
  const fresh = estimateCostUsd({ ...EMPTY_BREAKDOWN, inputTokens: MILLION }, 'grok-4.6');
  const cached = estimateCostUsd({ ...EMPTY_BREAKDOWN, cacheReadTokens: MILLION }, 'grok-4.6');
  const output = estimateCostUsd({ ...EMPTY_BREAKDOWN, outputTokens: MILLION }, 'grok-4.6');
  assert.equal(fresh?.totalUsd, 2);
  assert.equal(cached?.totalUsd, 0.5);
  assert.equal(output?.totalUsd, 6);
});

test('Grok 4.5 cache reads are cheaper than 4.6', () => {
  const cached45 = estimateCostUsd({ ...EMPTY_BREAKDOWN, cacheReadTokens: MILLION }, 'grok-4.5');
  const cached46 = estimateCostUsd({ ...EMPTY_BREAKDOWN, cacheReadTokens: MILLION }, 'grok-4.6');
  assert.equal(cached45?.totalUsd, 0.3);
  assert.equal(cached46?.totalUsd, 0.5);
});

test('Grok native usage subtracts cache from inclusive inputTokens', () => {
  const row = readUsageBreakdown({
    inputTokens: 2_871_452,
    outputTokens: 43_404,
    cachedReadTokens: 2_665_856,
    cacheCreationTokens: 0,
  });
  assert.equal(row.freshInput, 2_871_452 - 2_665_856);
  assert.equal(row.cacheRead, 2_665_856);
  assert.equal(row.output, 43_404);
});

test('Anthropic usage keeps input_tokens as fresh input', () => {
  const row = readUsageBreakdown({
    input_tokens: 40_217,
    output_tokens: 707,
    cache_read_input_tokens: 19_328,
    cache_creation_input_tokens: 0,
  });
  assert.equal(row.freshInput, 40_217);
  assert.equal(row.cacheRead, 19_328);
  assert.equal(row.output, 707);
});

test('cache-creation split reads the per-TTL detail when present', () => {
  const split = readCacheCreationSplit({
    cache_creation_input_tokens: 24_207,
    cache_creation: { ephemeral_1h_input_tokens: 24_207, ephemeral_5m_input_tokens: 0 },
  });
  assert.deepEqual(split, { cacheWrite5mTokens: 0, cacheWrite1hTokens: 24_207 });
});

test('older transcripts without a TTL split bill at the cheaper 5m rate', () => {
  const split = readCacheCreationSplit({ cache_creation_input_tokens: 1_000 });
  assert.deepEqual(split, { cacheWrite5mTokens: 1_000, cacheWrite1hTokens: 0 });
  assert.deepEqual(readCacheCreationSplit(null), {
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
  });
});
