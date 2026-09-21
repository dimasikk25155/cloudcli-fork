import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GROK_FALLBACK_MODELS,
  GROK_MODE_PRESETS,
  GrokProviderModels,
  buildGrokCatalogFromCache,
  readGrokModelsDefinition,
  resolveGrokModePreset,
} from '@/modules/providers/list/grok/grok-models.provider.js';

test('the picker offers the real models with 4.7 first, newest to oldest', () => {
  const visible = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => !option.hidden);

  assert.deepEqual(visible.map((option) => option.value), [
    'grok-4.7',
    'grok-4.7-build-fast',
    'grok-4.6',
    'grok-4.5',
  ]);
  assert.deepEqual(visible.map((option) => option.label), [
    'Grok 4.7',
    'Grok 4.7 Fast',
    'Grok 4.6',
    'Grok 4.5',
  ]);
  assert.equal(GROK_FALLBACK_MODELS.DEFAULT, 'grok-4.7');
});

test('every visible model carries an effort chip that defaults to the CLI default (high)', () => {
  // 22.09.2026: месяц на пресете «4.6 Build» без единого намёка, что есть
  // xhigh — чип уровня обязан быть у каждой предлагаемой модели.
  for (const option of GROK_FALLBACK_MODELS.OPTIONS.filter((entry) => !entry.hidden)) {
    assert.match(option.label, /Grok 4\.\d/);
    assert.ok(option.effort?.values.length, `${option.value} must offer effort levels`);
    assert.equal(option.effort?.default, 'high');
  }
});

test('mode presets stay in the catalog, hidden but wired', () => {
  // Сессия или localStorage со старым id должны продолжать работать —
  // «спрятан» здесь значит «не предлагаем», а не «выпилен».
  const hidden = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => option.hidden);

  assert.deepEqual(hidden.map((option) => option.value), [
    'grok-mode-build',
    'grok-mode-fast',
    'grok-mode-auto',
    'grok-mode-expert',
    'grok-mode-heavy',
  ]);
  for (const option of hidden) {
    assert.ok(GROK_MODE_PRESETS[option.value], `${option.value} must resolve to a preset`);
  }
});

test('effort levels stay model-specific — xhigh exists on 4.6 and newer, not on 4.5', () => {
  // Замерено на 1.0.5 (и не изменилось на 1.0.40): `grok-4.5 --effort xhigh`
  // — это ошибка разбора argv, прогон умирает до похода в xAI, а не понижает уровень.
  const levels = (value: string) => GROK_FALLBACK_MODELS.OPTIONS
    .find((option) => option.value === value)?.effort?.values.map((level) => level.value);

  assert.deepEqual(levels('grok-4.7'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(levels('grok-4.7-build-fast'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(levels('grok-4.6'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(levels('grok-4.5'), ['low', 'medium', 'high']);
});

test('every preset points at a real model and a level that model accepts', () => {
  for (const [presetId, preset] of Object.entries(GROK_MODE_PRESETS)) {
    const target = GROK_FALLBACK_MODELS.OPTIONS.find((option) => option.value === preset.model);
    assert.ok(target, `${presetId} points at unknown model ${preset.model}`);

    if (preset.effort !== null) {
      const allowed = target!.effort?.values.map((level) => level.value) ?? [];
      assert.ok(
        allowed.includes(preset.effort),
        `${presetId} asks ${preset.model} for "${preset.effort}", which it rejects`,
      );
    }
  }
});

test('preset ids keep the grok- prefix the pricing table matches on', () => {
  // token-pricing.ts матчит окно контекста (500K) по префиксу `grok`.
  for (const presetId of Object.keys(GROK_MODE_PRESETS)) {
    assert.ok(presetId.startsWith('grok-'), `${presetId} would fall out of the pricing table`);
  }
});

test('every mode carries an identity rule; only heavy asks for a panel', () => {
  for (const [id, preset] of Object.entries(GROK_MODE_PRESETS)) {
    assert.match(preset.rule || '', /MODEL IDENTITY/, `${id} needs an identity rule`);
  }
  assert.match(GROK_MODE_PRESETS['grok-mode-heavy'].rule!, /parallel subagents/);
  for (const [id, preset] of Object.entries(GROK_MODE_PRESETS)) {
    if (id === 'grok-mode-heavy') continue;
    assert.doesNotMatch(preset.rule || '', /parallel subagents/, `${id} must not emulate heavy`);
  }
});

test('resolveGrokModePreset only claims ids it actually owns', () => {
  assert.equal(resolveGrokModePreset('grok-mode-fast')?.model, 'grok-4.7');
  assert.equal(resolveGrokModePreset('grok-mode-build')?.model, 'grok-4.7');
  assert.equal(resolveGrokModePreset('grok-4.7'), null);
  assert.equal(resolveGrokModePreset(null), null);
  assert.equal(resolveGrokModePreset(undefined), null);
  assert.equal(resolveGrokModePreset('constructor'), null);
});

test('Grok models provider returns a catalog whose default is a visible real model', async () => {
  const provider = new GrokProviderModels();
  const catalog = await provider.getSupportedModels();

  const def = catalog.OPTIONS.find((option) => option.value === catalog.DEFAULT);
  assert.ok(def && !def.hidden, 'default must be offered in the picker');
  assert.equal(resolveGrokModePreset(catalog.DEFAULT), null, 'default must be a real model, not a preset');

  const current = await provider.getCurrentActiveModel();
  assert.equal(current.model, catalog.DEFAULT);
});

// Slice of the real ~/.grok/models_cache.json written by grok 1.0.40 (22.09.2026).
const CLI_CACHE = {
  fetched_at: '2026-09-21T23:14:22Z',
  models: {
    'grok-4.7': {
      info: {
        id: 'grok-4.7', name: 'Grok 4.7', description: "SpaceXAI's latest frontier model", hidden: false,
        reasoning_effort: 'high', supports_reasoning_effort: true,
        reasoning_efforts: [{ value: 'xhigh' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
      },
    },
    'grok-4.7-build-fast': {
      info: {
        id: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast', description: 'Fast variant. 2x the price.', hidden: false,
        reasoning_effort: 'high', supports_reasoning_effort: true,
        reasoning_efforts: [{ value: 'xhigh' }, { value: 'high' }, { value: 'medium' }, { value: 'low' }],
      },
    },
    'grok-4.5': {
      info: {
        id: 'grok-4.5', name: 'Grok 4.5', description: null, hidden: false,
        reasoning_effort: 'high', supports_reasoning_effort: true,
        reasoning_efforts: [{ value: 'high' }, { value: 'medium' }, { value: 'low' }],
      },
    },
    'grok-secret': {
      info: { id: 'grok-secret', name: 'Secret', hidden: true, reasoning_efforts: [] },
    },
  },
};

test('the live catalog follows the CLI cache: every listed model, its levels weakest-first, its default', () => {
  const catalog = buildGrokCatalogFromCache(CLI_CACHE)!;
  const visible = catalog.OPTIONS.filter((option) => !option.hidden);

  assert.deepEqual(visible.map((option) => option.value), ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.5']);
  assert.equal(visible[0].label, 'Grok 4.7');
  assert.deepEqual(visible[0].effort?.values.map((level) => level.value), ['low', 'medium', 'high', 'xhigh']);
  assert.equal(visible[0].effort?.default, 'high');
  assert.deepEqual(visible[2].effort?.values.map((level) => level.value), ['low', 'medium', 'high']);
  assert.equal(catalog.DEFAULT, 'grok-4.7');
  // Hidden on xAI's side stays hidden here — it is not even listed.
  assert.ok(!catalog.OPTIONS.some((option) => option.value === 'grok-secret'));
});

test('the live catalog keeps our descriptions where we have them and the CLI text elsewhere', () => {
  const catalog = buildGrokCatalogFromCache(CLI_CACHE)!;
  const byId = Object.fromEntries(catalog.OPTIONS.map((option) => [option.value, option]));
  assert.match(String(byId['grok-4.7'].description), /SuperGrok/);
  assert.match(String(byId['grok-4.7-build-fast'].description), /2 раза дороже/);
  assert.equal(byId['grok-4.5'].description, GROK_FALLBACK_MODELS.OPTIONS.find((o) => o.value === 'grok-4.5')?.description);
});

test('the live catalog carries the presets hidden, minus any whose model the CLI dropped', () => {
  const catalog = buildGrokCatalogFromCache(CLI_CACHE)!;
  const hidden = catalog.OPTIONS.filter((option) => option.hidden).map((option) => option.value);
  // grok-4.6 is absent from this cache slice, so nothing here targets it;
  // 'grok-mode-expert' targets 4.5, which is present.
  assert.ok(hidden.includes('grok-mode-build'));
  assert.ok(hidden.includes('grok-mode-expert'));
  for (const presetId of hidden) {
    assert.ok(
      catalog.OPTIONS.some((option) => option.value === GROK_MODE_PRESETS[presetId].model),
      `${presetId} must point at a model the CLI still serves`,
    );
  }
});

test('a broken or missing CLI cache falls back to the static catalog', () => {
  assert.equal(buildGrokCatalogFromCache(null), null);
  assert.equal(buildGrokCatalogFromCache({ models: {} }), null);
  assert.equal(readGrokModelsDefinition(path.join(os.tmpdir(), 'no-such-grok-cache.json')), GROK_FALLBACK_MODELS);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cache-'));
  const file = path.join(dir, 'models_cache.json');
  fs.writeFileSync(file, '{ not json');
  assert.equal(readGrokModelsDefinition(file), GROK_FALLBACK_MODELS);

  fs.writeFileSync(file, JSON.stringify(CLI_CACHE));
  const first = readGrokModelsDefinition(file);
  assert.equal(first.DEFAULT, 'grok-4.7');
  // Same mtime → same object (memoised); a rewrite is picked up.
  assert.equal(readGrokModelsDefinition(file), first);
  fs.rmSync(dir, { recursive: true, force: true });
});
