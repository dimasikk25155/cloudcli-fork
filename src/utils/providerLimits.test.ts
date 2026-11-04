import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderLimits } from './providerLimits.js';

// Payloads below are copies of what the server answers today:
// GET /api/usage/limits (Claude) → {ok, usage:{fiveHour, sevenDay}, guard}
// GET /api/usage/limits?provider=codex → {ok, codex:{windows:[…], planType, fetchedAt}}
// GET …/sessions/:id/token-usage → {used, total, inputTokens, outputTokens}

test('Claude: context is the last occupancy over the model window; 5-hour and weekly windows with resets', () => {
  const limits = normalizeProviderLimits('claude', {
    tokenUsage: { used: 250_000, total: 1_000_000, inputTokens: 9_000_000, outputTokens: 40_000 },
    contextWindow: 1_000_000,
    limits: {
      ok: true,
      usage: {
        fiveHour: { utilization: 16, resetsAt: '2026-11-04T15:00:00Z' },
        sevenDay: { utilization: 36.4, resetsAt: '2026-11-08T09:00:00Z' },
      },
      guard: { threshold: 90, blocked: false },
    },
  });
  // 250 000 / 1 000 000 = 25 % — cumulative spend (9 M input) is not the occupancy.
  assert.deepEqual(limits.context, { usedPct: 25, used: 250_000, window: 1_000_000 });
  assert.equal(limits.known, true);
  assert.deepEqual(limits.windows, [
    { label: '5 часов', utilization: 16, resetsAt: '2026-11-04T15:00:00Z' },
    { label: 'Неделя', utilization: 36.4, resetsAt: '2026-11-08T09:00:00Z' },
  ]);
});

test('Claude: limits that did not load stay unknown, never 0', () => {
  const limits = normalizeProviderLimits('claude', { tokenUsage: null, contextWindow: 200_000, limits: null });
  assert.deepEqual(limits.context, { usedPct: null, used: null, window: 200_000 });
  assert.equal(limits.known, true);
  assert.deepEqual(limits.windows, [
    { label: '5 часов', utilization: null, resetsAt: null },
    { label: 'Неделя', utilization: null, resetsAt: null },
  ]);
});

test('Codex: windows come from the codex block, labelled by their length', () => {
  const limits = normalizeProviderLimits('codex', {
    tokenUsage: { used: 129_000 },
    contextWindow: 258_000,
    limits: {
      ok: true,
      codex: {
        windows: [
          { utilization: 41, windowMinutes: 300, resetsAt: '2026-11-04T16:10:00Z' },
          { utilization: 7, windowMinutes: 10_080, resetsAt: null },
        ],
        planType: 'pro',
        fetchedAt: '2026-11-04T12:00:00Z',
      },
    },
  });
  assert.deepEqual(limits.context, { usedPct: 50, used: 129_000, window: 258_000 });
  assert.equal(limits.known, true);
  assert.deepEqual(limits.windows, [
    { label: '5 часов', utilization: 41, resetsAt: '2026-11-04T16:10:00Z' },
    { label: 'Неделя', utilization: 7, resetsAt: null },
  ]);
});

test('Codex: no codex block → no invented windows', () => {
  const limits = normalizeProviderLimits('codex', { tokenUsage: { used: 10 }, contextWindow: null, limits: { ok: false } });
  assert.deepEqual(limits.context, { usedPct: null, used: 10, window: null });
  assert.equal(limits.known, true);
  assert.deepEqual(limits.windows, []);
});

test('Grok: context is shown, subscription limits are not reported', () => {
  const limits = normalizeProviderLimits('grok', {
    tokenUsage: { used: 100_000 },
    contextWindow: 500_000,
    // Even if a Claude payload is passed by mistake, it must not leak into Grok.
    limits: { ok: true, usage: { fiveHour: { utilization: 80, resetsAt: null } } },
  });
  assert.deepEqual(limits.context, { usedPct: 20, used: 100_000, window: 500_000 });
  assert.equal(limits.known, false);
  assert.deepEqual(limits.windows, []);
});

test('garbage numbers are unknown', () => {
  const limits = normalizeProviderLimits('claude', {
    tokenUsage: { used: -5 },
    contextWindow: Number.NaN,
    limits: { usage: { fiveHour: { utilization: 'много' }, sevenDay: null } },
  });
  assert.deepEqual(limits.context, { usedPct: null, used: null, window: null });
  assert.deepEqual(limits.windows.map((window) => window.utilization), [null, null]);
});
