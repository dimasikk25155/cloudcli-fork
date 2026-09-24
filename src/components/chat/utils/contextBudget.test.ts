import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeContextBudget } from './contextBudget';
test('live context accepts compaction decreases, explicit zero/null, missing preserves known occupancy', () => {
  const large = { used: 80000, inputTokens: 900000 };
  assert.equal(mergeContextBudget(large, { used: 20000 }).used, 20000);
  assert.equal(mergeContextBudget(large, { used: 0 }).used, 0);
  assert.equal(mergeContextBudget(large, { used: null }).used, null);
  assert.equal(mergeContextBudget(large, { inputTokens: 1000000 }).used, 80000);
});

test('late events from another or unidentified session cannot change the visible budget', async () => {
  const { applyContextBudgetEvent } = await import('./contextBudget');
  const previous = { used: 20000 };
  assert.equal(applyContextBudgetEvent(previous, { used: 95000 }, 'old', 'current'), previous);
  assert.equal(applyContextBudgetEvent(previous, { used: 95000 }, null, 'current'), previous);
  assert.equal(applyContextBudgetEvent(previous, { used: 10000 }, 'current', 'current')?.used, 10000);
});

test('draft zero becomes unknown on opening an existing session without usage', async () => {
  const { contextBudgetOnSessionChange } = await import('./contextBudget');
  const restored = contextBudgetOnSessionChange({ used: 0 }, null, 'existing-session');
  assert.equal(restored, null);
  // Missing history data or a failed REST request leaves this unknown value intact.
  assert.equal(mergeContextBudget(restored, {}).used, null);
  assert.deepEqual(contextBudgetOnSessionChange({ used: 20000 }, 'existing-session', 'existing-session'), { used: 20000 });
  assert.deepEqual(contextBudgetOnSessionChange({ used: 20000 }, 'existing-session', null), { used: 0 });
});
