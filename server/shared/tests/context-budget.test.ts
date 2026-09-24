import assert from 'node:assert/strict';
import test from 'node:test';

import { readCodexContextBudget, readClaudeContextBudget } from '../context-budget.js';

test('Codex last occupancy includes cached subset once and reasoning output once, independent of spend', () => {
  const budget = readCodexContextBudget({ info: { model_context_window: 258400,
    total_token_usage: { input_tokens: 790000, output_tokens: 10000, total_tokens: 800000 },
    last_token_usage: { input_tokens: 45000, cached_input_tokens: 40000, output_tokens: 5000, reasoning_output_tokens: 3000, total_tokens: 50000 },
  } });
  assert.equal(budget?.used, 50000);
  assert.equal(budget?.inputTokens, 790000);
  assert.equal(budget?.total, 258400);
  assert.equal(readCodexContextBudget({ type: 'turn.completed', usage: { input_tokens: 900000, output_tokens: 1000 } })?.used, null);
});

test('Claude main assistant footprint includes separate caches; aggregates and subagents cannot replace it', () => {
  const message = { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10000, cache_read_input_tokens: 35000, cache_creation_input_tokens: 4000, output_tokens: 1000 } } };
  assert.equal(readClaudeContextBudget(message)?.used, 50000);
  assert.equal(readClaudeContextBudget({ ...message, parent_tool_use_id: 'tool-1' }), null);
  assert.equal(readClaudeContextBudget({ type: 'result', usage: { input_tokens: 900000 } }), null);
  assert.equal(readClaudeContextBudget({ ...message, message: { ...message.message, model: '<synthetic>' } }), null);
  assert.equal(readClaudeContextBudget({ type: 'system', subtype: 'compact_boundary' })?.used, null);
});
