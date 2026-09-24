import assert from 'node:assert/strict';
import test from 'node:test';

import type { LLMProvider } from '../../../types/app';

import {
  applyProviderModel,
  modelForProvider,
  resolveModelEffort,
  type ProviderModelSetters,
} from './providerModelState.js';

const PROVIDERS: LLMProvider[] = [
  'claude',
  'cursor',
  'codex',
  'opencode',
  'kimi',
  'gemini',
  'grok',
];

const trackingSetters = () => {
  const written: Partial<Record<LLMProvider, string>> = {};
  const setters = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider,
      (model: string) => {
        written[provider] = model;
      },
    ]),
  ) as ProviderModelSetters;
  return { written, setters };
};

test('applyProviderModel writes grok through the grok setter, not kimi or cursor', () => {
  const { written, setters } = trackingSetters();
  applyProviderModel('grok', 'grok-mode-fast', setters);
  assert.equal(written.grok, 'grok-mode-fast');
  assert.equal(written.kimi, undefined);
  assert.equal(written.cursor, undefined);
});

test('every provider writes only its own slot', () => {
  for (const provider of PROVIDERS) {
    const { written, setters } = trackingSetters();
    applyProviderModel(provider, `${provider}-picked`, setters);
    assert.equal(written[provider], `${provider}-picked`);
    for (const other of PROVIDERS) {
      if (other !== provider) {
        assert.equal(written[other], undefined, `${provider} leaked into ${other}`);
      }
    }
  }
});

test('modelForProvider reads grok from grok, not from the catch-all', () => {
  const models: Record<LLMProvider, string> = {
    claude: 'claude-default',
    cursor: 'cursor-default',
    codex: 'codex-default',
    opencode: 'opencode-default',
    kimi: 'kimi-default',
    gemini: 'gemini-default',
    grok: 'grok-mode-heavy',
  };
  assert.equal(modelForProvider('grok', models), 'grok-mode-heavy');
  assert.equal(modelForProvider('kimi', models), 'kimi-default');
  assert.equal(modelForProvider('cursor', models), 'cursor-default');
});

const astra = { value: 'gpt-6-astra', label: 'GPT-6 Astra', effort: { default: 'medium', values: ['low', 'medium', 'high', 'ultra'].map(value => ({ value })) } };
const sol = { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', effort: { default: 'low', values: ['low', 'medium', 'high', 'ultra'].map(value => ({ value })) } };

test('model defaults remain symbolic and an explicit override cannot cross model boundaries', () => {
  assert.equal(resolveModelEffort(astra), 'default');
  assert.equal(resolveModelEffort(sol, { model: 'gpt-6-astra', effort: 'high' }), 'default');
  assert.equal(resolveModelEffort(sol, { model: 'gpt-5.6-sol', effort: 'ultra' }), 'ultra');
});

test('reset survives persistence and follows changed catalogue defaults rather than freezing old defaults', () => {
  const saved = JSON.parse(JSON.stringify({ model: 'gpt-5.6-sol', effort: 'default' }));
  assert.equal(resolveModelEffort(sol, saved), 'default');
  assert.equal(resolveModelEffort({ ...sol, effort: { ...sol.effort, default: 'medium' } }, saved), 'default');
  assert.equal(resolveModelEffort(sol, { model: sol.value, effort: 'removed-level' }), 'default');
  assert.equal(resolveModelEffort({ value: 'no-reasoning', label: 'No reasoning' }, { model: 'no-reasoning', effort: 'high' }), 'default');
});
