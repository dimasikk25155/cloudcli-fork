import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildCodexModelsDefinition,
  CODEX_FALLBACK_MODELS,
  CodexProviderModels,
} from '@/modules/providers/list/codex/codex-models.provider.js';

const RECOMMENDED_CODEX_MODELS = [
  'gpt-6-astra',
  'gpt-5.6-sol',
];

test('Codex fallback always offers the selected Astra and Sol families', () => {
  assert.deepEqual(
    CODEX_FALLBACK_MODELS.OPTIONS.filter((option) => !option.hidden).map((option) => option.value),
    RECOMMENDED_CODEX_MODELS,
  );
  assert.equal(CODEX_FALLBACK_MODELS.DEFAULT, 'gpt-5.6-sol');
});

test('partial cache retains curated families, correct defaults and maximum CLI context', () => {
  const result = buildCodexModelsDefinition([{ slug: 'gpt-5.6-terra', visibility: 'list' }]);
  assert.deepEqual(result.OPTIONS.filter((o) => !o.hidden).map((o) => o.value), RECOMMENDED_CODEX_MODELS);
  assert.equal(result.OPTIONS.find((o) => o.value === 'gpt-6-astra')?.effort?.default, 'medium');
  assert.equal(result.OPTIONS.find((o) => o.value === 'gpt-5.6-sol')?.effort?.default, 'low');
  assert.equal(result.OPTIONS.find((o) => o.value === 'gpt-5.6-sol')?.contextWindow, 872000);
});

test('a rewritten cache discovers newer selected families and retains valid data on malformed refresh', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-refresh-'));
  const file = path.join(dir, 'models.json');
  const provider = new CodexProviderModels(file);
  try {
    assert.equal((await provider.getSupportedModels()).DEFAULT, 'gpt-5.6-sol');
    await writeFile(file, JSON.stringify({ models: [
      { slug: 'gpt-6-sol', display_name: 'GPT-6 Sol', visibility: 'list', context_window: 300000, max_context_window: 900000,
        default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'low' }] },
      { slug: 'gpt-6-terra', visibility: 'list' },
    ] }));
    const fresh = await provider.getSupportedModels();
    assert.equal(fresh.DEFAULT, 'gpt-6-sol');
    assert.deepEqual(fresh.OPTIONS.filter((o) => !o.hidden).map((o) => o.value), ['gpt-6-astra', 'gpt-6-sol']);
    assert.equal(fresh.OPTIONS[1].contextWindow, 900000);
    assert.deepEqual(fresh.OPTIONS[1].effort, { default: 'low', values: [{ value: 'low' }, { value: 'high' }] });
    await writeFile(file, JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }] }));
    assert.deepEqual((await provider.getSupportedModels()).OPTIONS[1], fresh.OPTIONS[1]);
    await writeFile(file, '{broken');
    assert.deepEqual(await provider.getSupportedModels(), fresh);
    await writeFile(file, JSON.stringify({ models: [] }));
    assert.deepEqual(await provider.getSupportedModels(), fresh);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
