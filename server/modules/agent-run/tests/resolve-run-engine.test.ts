import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_UNATTENDED_PROVIDER,
  resolveRunEngine,
} from '@/modules/agent-run/agent-run.service.js';

test('an omitted provider lands on Grok, not Claude', () => {
  assert.equal(DEFAULT_UNATTENDED_PROVIDER, 'grok');
  const resolved = resolveRunEngine({});
  assert.equal(resolved.provider, 'grok');
  assert.equal(resolved.model, undefined);
  assert.equal(resolved.effort, undefined);
});

test('an explicit provider wins over the user default and the fallback', () => {
  const resolved = resolveRunEngine({
    requestedProvider: 'claude',
    preferences: { defaultProvider: 'grok', models: { claude: 'sonnet', grok: 'grok-4.6' } },
  });
  assert.equal(resolved.provider, 'claude');
  assert.equal(resolved.model, 'sonnet');
});

test('the user default engine is used when the caller did not pick one', () => {
  const resolved = resolveRunEngine({
    preferences: {
      defaultProvider: 'kimi',
      models: { kimi: 'k2' },
      efforts: { kimi: 'high' },
    },
  });
  assert.equal(resolved.provider, 'kimi');
  assert.equal(resolved.model, 'k2');
  assert.equal(resolved.effort, 'high');
});

test('an explicit model/effort beat the stored preference', () => {
  const resolved = resolveRunEngine({
    requestedProvider: 'grok',
    requestedModel: 'grok-4.5',
    requestedEffort: 'low',
    preferences: {
      defaultProvider: 'grok',
      models: { grok: 'grok-4.6' },
      efforts: { grok: 'high' },
    },
  });
  assert.equal(resolved.provider, 'grok');
  assert.equal(resolved.model, 'grok-4.5');
  assert.equal(resolved.effort, 'low');
});

test('garbage provider strings are ignored rather than thrown', () => {
  const resolved = resolveRunEngine({
    requestedProvider: 'not-an-engine',
    preferences: { defaultProvider: 'also-fake' },
  });
  assert.equal(resolved.provider, 'grok');
});
