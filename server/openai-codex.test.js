import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';

import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { queryCodex, buildCodexClientOptions } from './openai-codex.js';

test('Codex receives the same Neo3 hook marker as Claude and Grok', () => {
  assert.equal(buildCodexClientOptions({}, {}).env.NEO3_SESSION, '1');
});

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

test('Codex tool progress updates one row per turn and never overwrites a previous turn', async (t) => {
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: { DEFAULT: 'fixture', OPTIONS: [] } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async () => 'fixture');
  t.mock.method(providerModelsService, 'resolveResumeEffort', async () => undefined);
  t.mock.method(Codex.prototype, 'startThread', () => ({
    runStreamed: async () => ({ events: (async function* () {
      yield { type: 'thread.started', thread_id: 'fixture-progress' };
      yield { type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'fixture', status: 'in_progress' } };
      yield { type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'fixture', status: 'completed', exit_code: 0, aggregated_output: 'ok' } };
      yield { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 } };
    })() }),
  }));
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const rows = [];
    const metered = [];
    await queryCodex('fixture', { meter: { addMessage: (message) => metered.push(message) } }, { send: (value) => rows.push(typeof value === 'string' ? JSON.parse(value) : value) });
    const tools = rows.filter((row) => row.kind === 'tool_use');
    assert.equal(tools.length, 2);
    assert.equal(tools[0].id, tools[1].id);
    assert.equal(tools[0].status, 'in_progress');
    assert.equal(tools[1].status, 'completed');
    assert.equal(metered[0].usage.input_tokens, 5);
    ids.push(tools[0].id);
  }
  assert.notEqual(ids[0], ids[1]);
});

test('SDK developer context and launch options agree on explicit High and resolved Low', async (t) => {
  const launches = [];
  const instructions = [];
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: {
    DEFAULT: 'gpt-6.1-sol', OPTIONS: [{ value: 'gpt-6.1-sol', effort: {
      default: 'low', values: [{ value: 'low' }, { value: 'high' }],
    } }],
  } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async () => 'gpt-6.1-sol');
  t.mock.method(providerModelsService, 'resolveResumeEffort', async (_p, _s, effort) => effort);
  t.mock.method(Codex.prototype, 'startThread', function (options) {
    launches.push(options);
    // SDK stores the same client configuration used to spawn its CLI.
    instructions.push(this.options.config.developer_instructions);
    return { runStreamed: async () => { const error = new Error('test boundary'); error.name = 'AbortError'; throw error; } };
  });
  for (const effort of ['high', 'default']) await queryCodex('fixture', { effort }, { send() {} });
  assert.deepEqual(launches.map(o => o.modelReasoningEffort), ['high', 'low']);
  assert.match(instructions[0], /model="gpt-6\.1-sol"; reasoning_effort="high"/);
  assert.match(instructions[1], /reasoning_effort="low"/);
  assert.equal(typeof buildCodexClientOptions({}, { instructions: instructions[0] }).config.developer_instructions, 'string');
});
