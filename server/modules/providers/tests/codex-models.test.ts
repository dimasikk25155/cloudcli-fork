import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexModelsDefinition,
  CODEX_FALLBACK_MODELS,
} from '@/modules/providers/list/codex/codex-models.provider.js';

const RECOMMENDED_CODEX_MODELS = [
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
];

test('Codex fallback always offers the four current recommended models', () => {
  assert.deepEqual(
    CODEX_FALLBACK_MODELS.OPTIONS.map((option) => option.value),
    RECOMMENDED_CODEX_MODELS,
  );
  assert.equal(CODEX_FALLBACK_MODELS.DEFAULT, 'gpt-5.6-sol');
});

test('a partial CLI cache cannot remove recommended models from the shared picker', () => {
  const result = buildCodexModelsDefinition([
    {
      slug: 'gpt-5.6-terra',
      display_name: 'GPT-5.6-Terra',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'high', description: 'Cached level' }],
    },
    {
      slug: 'gpt-5.5',
      display_name: 'GPT-5.5',
      visibility: 'list',
      supported_in_api: true,
      priority: 2,
    },
  ]);

  assert.deepEqual(
    result.OPTIONS.slice(0, 4).map((option) => option.value),
    RECOMMENDED_CODEX_MODELS,
  );
  assert.equal(result.OPTIONS[2]?.label, 'GPT-5.6 Terra');
  assert.deepEqual(result.OPTIONS[2]?.effort?.values, [
    { value: 'high', description: 'Cached level' },
  ]);
  assert.equal(result.OPTIONS[4]?.value, 'gpt-5.5');
  assert.equal(result.DEFAULT, 'gpt-5.6-sol');
});
