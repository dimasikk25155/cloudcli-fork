import assert from 'node:assert/strict';
import test from 'node:test';

import { SELECTABLE_PROVIDERS, selectableModels } from '../../../utils/providerSelectionPolicy';
import type { LLMProvider } from '../../../types/app';

import {
  applyProviderModel,
  modelForProvider,
  resolveModelEffort,
  resolveChatSelection,
  persistNewChatModelDefault,
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


test('new-chat selection rejects stale providers and hidden saved models even with absent or poisoned catalogues', () => {
  const definition = { DEFAULT: 'gpt-5.6-terra', OPTIONS: [
    { value: 'gpt-5.6-terra', label: 'Terra' },
    { ...astra, hidden: true },
    sol,
  ] };
  assert.deepEqual(resolveChatSelection('cursor', 'cursor-auto'), { provider: 'grok', model: 'grok-4.7' });
  assert.deepEqual(resolveChatSelection('codex', 'gpt-6-astra', definition), { provider: 'codex', model: 'gpt-5.6-sol' });
  assert.deepEqual(resolveChatSelection('codex', 'gpt-5.6-terra', definition), { provider: 'codex', model: 'gpt-5.6-sol' });
  assert.deepEqual(resolveChatSelection('claude', 'local-qwen35-9b'), { provider: 'claude', model: 'opus[1m]' });
  assert.deepEqual(resolveChatSelection('codex', 'removed-model', { DEFAULT: 'removed-model', OPTIONS: [] }), { provider: 'codex', model: 'gpt-5.6-sol' });
});


test('historical sessions retain removed provider and model while the next draft is curated', () => {
  const catalogue = { DEFAULT: sol.value, OPTIONS: [sol, { ...astra, hidden: true }] };
  assert.deepEqual(resolveChatSelection('cursor', 'cursor-auto', undefined, 'session-old'), { provider: 'cursor', model: 'cursor-auto' });
  assert.deepEqual(resolveChatSelection('codex', 'gpt-6-astra', catalogue, 'session-old'), { provider: 'codex', model: 'gpt-6-astra' });
  assert.deepEqual(resolveChatSelection('codex', 'gpt-6-astra', catalogue, null), { provider: 'codex', model: 'gpt-5.6-sol' });
});


test('new choice lists stay curated across refreshes and never restore a hidden saved default', () => {
  const definition = { DEFAULT: 'gpt-6-astra', OPTIONS: [
    { ...astra, hidden: true }, sol,
    { value: 'gpt-5.6-terra', label: 'Terra' },
    { value: 'gpt-7-astra', label: 'Future confirmed Astra' },
  ] };
  assert.deepEqual(SELECTABLE_PROVIDERS, ['claude', 'codex', 'grok']);
  assert.deepEqual(selectableModels('codex', definition).map(option => option.value), ['gpt-5.6-sol', 'gpt-7-astra']);
  assert.deepEqual(selectableModels('cursor', definition), []);
  assert.deepEqual(selectableModels('codex', null), []);
  assert.deepEqual(selectableModels('claude', { DEFAULT: 'haiku', OPTIONS: [
    { value: 'haiku', label: 'Haiku' }, { value: 'opus[1m]', label: 'Opus 5.5' },
  ] }).map(option => option.value), ['opus[1m]']);
  assert.deepEqual(selectableModels('grok', { DEFAULT: 'grok-4.5', OPTIONS: [
    { value: 'grok-4.5', label: 'Grok 4.5' }, { value: 'grok-4.7-build-fast', label: 'Fast' },
  ] }).map(option => option.value), ['grok-4.7-build-fast']);
});


test('changing a normalized hidden default persists model and effort together across reload', async () => {
  const catalogue = { DEFAULT: sol.value, OPTIONS: [sol, astra,
    { value: 'gpt-5.6-terra', label: 'Terra', hidden: true },
  ] };
  const saved = { model: 'gpt-5.6-terra', effort: 'high' };
  const loadedModel = resolveChatSelection('codex', saved.model, catalogue).model;
  const loadedEffort = resolveModelEffort(sol, saved);
  assert.equal(loadedModel, 'gpt-5.6-sol');
  assert.equal(loadedEffort, 'default');

  const changedEffort = resolveModelEffort(astra, { model: loadedModel, effort: loadedEffort });
  await persistNewChatModelDefault('codex', astra.value, changedEffort, async (path, body) => {
    if (path === 'model') saved.model = body.model as string;
    if (path === 'effort') saved.effort = body.effort as string;
  });

  const reloadedModel = resolveChatSelection('codex', saved.model, catalogue).model;
  assert.equal(reloadedModel, 'gpt-6-astra');
  assert.equal(resolveModelEffort(astra, saved), 'default');
  assert.equal(saved.effort, 'default');
});
