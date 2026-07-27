import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_FALLBACK_MODELS,
  KimiProviderModels,
} from '@/modules/providers/list/kimi/kimi-models.provider.js';

test('Kimi fallback catalog lists the managed subscription models', () => {
  const values = KIMI_FALLBACK_MODELS.OPTIONS.map((option) => option.value);

  assert.deepEqual(values, [
    'kimi-code/k3',
    'kimi-code/k3-low',
    'kimi-code/k3-max',
    'kimi-code/kimi-for-coding',
    'kimi-code/kimi-for-coding-highspeed',
  ]);
  assert.equal(KIMI_FALLBACK_MODELS.DEFAULT, 'kimi-code/k3');
});

test('Kimi model aliases match the CLI config.toml entries', () => {
  // `kimi -m <alias>` is passed verbatim; aliases must keep the
  // `kimi-code/<model>` shape the managed provider registers in config.toml.
  for (const option of KIMI_FALLBACK_MODELS.OPTIONS) {
    assert.ok(option.value.startsWith('kimi-code/'), `alias ${option.value} must be provider-prefixed`);
  }
});

test('Kimi models provider returns the static catalog and default current model', async () => {
  const provider = new KimiProviderModels();

  assert.deepEqual(await provider.getSupportedModels(), KIMI_FALLBACK_MODELS);

  const current = await provider.getCurrentActiveModel();
  assert.equal(current.model, KIMI_FALLBACK_MODELS.DEFAULT);
});
