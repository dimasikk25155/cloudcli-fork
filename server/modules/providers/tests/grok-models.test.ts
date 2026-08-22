import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GROK_FALLBACK_MODELS,
  GROK_MODE_PRESETS,
  GrokProviderModels,
  resolveGrokModePreset,
} from '@/modules/providers/list/grok/grok-models.provider.js';

test('the picker offers the five grok.com-style modes, in that order', () => {
  const visible = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => !option.hidden);

  assert.deepEqual(visible.map((option) => option.value), [
    'grok-mode-auto',
    'grok-mode-fast',
    'grok-mode-expert',
    'grok-mode-build',
    'grok-mode-heavy',
  ]);
  assert.deepEqual(visible.map((option) => option.label), [
    'Авто',
    'Быстрый',
    'Эксперт',
    'Build',
    'Тяжёлый',
  ]);
  assert.equal(GROK_FALLBACK_MODELS.DEFAULT, 'grok-mode-build');
});

test('every offered mode says which model and which level is behind it', () => {
  // Название режима само по себе не сообщает ничего: подпись под ним — это
  // единственное место, где видно, что «Быстрый» — это 4.5 на низком уровне.
  for (const option of GROK_FALLBACK_MODELS.OPTIONS.filter((entry) => !entry.hidden)) {
    assert.ok(option.description, `${option.value} must carry a description`);
    assert.match(option.description!, /Grok 4\.\d/);
  }
});

test('the raw models stay in the catalog, hidden but wired', () => {
  // Сессия или localStorage со старым id должны продолжать работать —
  // «спрятан» здесь значит «не предлагаем», а не «выпилен».
  const hidden = GROK_FALLBACK_MODELS.OPTIONS.filter((option) => option.hidden);

  assert.deepEqual(hidden.map((option) => option.value), ['grok-4.6', 'grok-4.5']);
  for (const option of hidden) {
    assert.ok(option.effort?.values.length, `${option.value} must keep its effort levels`);
  }
});

test('effort levels stay model-specific — xhigh exists on 4.6 only', () => {
  // Замерено на 1.0.5: `grok-4.5 --effort xhigh` — это ошибка разбора argv,
  // прогон умирает до похода в xAI, а не понижает уровень.
  const levels = (value: string) => GROK_FALLBACK_MODELS.OPTIONS
    .find((option) => option.value === value)?.effort?.values.map((level) => level.value);

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

test('only the heavy mode carries an extra rule, and it asks for a panel', () => {
  const withRules = Object.entries(GROK_MODE_PRESETS).filter(([, preset]) => preset.rule);

  assert.deepEqual(withRules.map(([id]) => id), ['grok-mode-heavy']);
  assert.match(GROK_MODE_PRESETS['grok-mode-heavy'].rule!, /parallel subagents/);
});

test('resolveGrokModePreset only claims ids it actually owns', () => {
  assert.equal(resolveGrokModePreset('grok-mode-fast')?.model, 'grok-4.5');
  assert.equal(resolveGrokModePreset('grok-4.6'), null);
  assert.equal(resolveGrokModePreset(null), null);
  assert.equal(resolveGrokModePreset(undefined), null);
  assert.equal(resolveGrokModePreset('constructor'), null);
});

test('Grok models provider returns the static catalog and default current model', async () => {
  const provider = new GrokProviderModels();

  assert.deepEqual(await provider.getSupportedModels(), GROK_FALLBACK_MODELS);

  const current = await provider.getCurrentActiveModel();
  assert.equal(current.model, GROK_FALLBACK_MODELS.DEFAULT);
});
