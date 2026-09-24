import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildClaudeModelsDefinition, readClaudeModelsDefinition, CLAUDE_FALLBACK_MODELS } from '../list/claude/claude-models.provider.js';

test('Claude curated catalog respects factory badge over saved state and available Sonnet version', () => {
  assert.deepEqual(CLAUDE_FALLBACK_MODELS.OPTIONS.filter((o) => !o.hidden).map((o) => o.label), ['Opus 5.5', 'Sonnet 5', 'Fable 5.1']);
  const result = buildClaudeModelsDefinition({ staleAt: 2000, catalog: {
    config: { models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5', thinking: { type: 'effort', effort_options: [
      { id: 'high' }, { id: 'medium', badge: { message: 'Default' } }, { id: 'low' },
    ] } }, { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', thinking: { effort_options: [{ id: 'high', badge: { message: 'Default' } }] } }] },
    state: { thinking_by_model: { 'opus[1m]': 'high' } },
  } }, 1000)!;
  assert.equal(result.OPTIONS[0].effort?.default, 'medium');
  assert.deepEqual(result.OPTIONS[0].effort?.values.map((o) => o.value), ['low', 'medium', 'high']);
  assert.equal(result.OPTIONS[1].label, 'Sonnet 5.5');
  assert.equal(result.OPTIONS[0].contextWindow, 1000000);
  assert.equal(buildClaudeModelsDefinition({ staleAt: 999, catalog: { config: { models: [] } } }, 1000), null);
});

test('Claude reader refreshes account metadata and rejects expired or corrupt replacements', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-catalog-'));
  const file = path.join(dir, 'test-cc.json');
  try {
    assert.equal(readClaudeModelsDefinition(dir, 1000), CLAUDE_FALLBACK_MODELS);
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: 900, staleAt: 2000, catalog: { config: { models: [
      { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', thinking: { type: 'none' } },
      { id: 'claude-haiku-6', name: 'Haiku 6' },
    ] } } }));
    const fresh = readClaudeModelsDefinition(dir, 1000);
    assert.equal(fresh.OPTIONS[1].label, 'Sonnet 5.5');
    assert.equal(fresh.OPTIONS[1].effort, undefined);
    assert.equal(fresh.OPTIONS[1].contextWindow, undefined);
    assert.equal(fresh.OPTIONS.filter((o) => !o.hidden).length, 3);
    fs.writeFileSync(file, '{broken');
    assert.equal(readClaudeModelsDefinition(dir, 1000), fresh);
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: 900, staleAt: 999, catalog: { config: { models: [{ id: 'claude-sonnet-6', name: 'Sonnet 6' }] } } }));
    assert.equal(readClaudeModelsDefinition(dir, 1000), fresh);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
