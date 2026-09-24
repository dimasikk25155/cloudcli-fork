import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';

import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { queryCodex } from './openai-codex.js';

test('Codex launch and effort resolver receive the same effective model when omitted', async (t) => {
  const launches = [];
  const effortModels = [];
  // No provider process runs: stop at the SDK thread boundary after capturing options.
  const makeThread = (options) => {
    launches.push(options);
    return { runStreamed: async () => { const error = new Error('test boundary'); error.name = 'AbortError'; throw error; } };
  };
  t.mock.method(Codex.prototype, 'startThread', makeThread);
  t.mock.method(Codex.prototype, 'resumeThread', (_id, options) => makeThread(options));
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: {
    DEFAULT: 'gpt-6-sol', OPTIONS: [
      { value: 'gpt-6-sol', effort: { default: 'medium', values: [{ value: 'medium' }] } },
      { value: 'explicit-model', effort: { default: 'low', values: [{ value: 'low' }] } },
    ],
  } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async (_provider, _session, model) => model);
  t.mock.method(providerModelsService, 'resolveResumeEffort', async (_provider, _session, _effort, model) => {
    effortModels.push(model);
    return model === 'explicit-model' ? 'low' : 'medium';
  });
  for (const options of [{}, { sessionId: 'restored-fixture' }, { model: 'explicit-model' }]) {
    await queryCodex('fixture', options, { send() {} });
  }
  assert.deepEqual(launches.map(({ model, modelReasoningEffort }) => ({ model, modelReasoningEffort })), [
    { model: 'gpt-6-sol', modelReasoningEffort: 'medium' },
    { model: 'gpt-6-sol', modelReasoningEffort: 'medium' },
    { model: 'explicit-model', modelReasoningEffort: 'low' },
  ]);
  assert.deepEqual(effortModels, ['gpt-6-sol', 'gpt-6-sol', 'explicit-model']);
});
