import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readCodexSessionBudget } from '../list/codex/codex-context.js';

test('Codex budget tail crosses large tool rows, refreshes appended occupancy and clears after compaction', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-budget-'));
  const file = path.join(dir, 'rollout.jsonl');
  const row = (used: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { total_tokens: used }, total_token_usage: { input_tokens: 900000 }, model_context_window: 475000,
  } } });
  try {
    await writeFile(file, `${row(80000)}\n${JSON.stringify({ type: 'response_item', payload: { text: 'я'.repeat(150000) } })}\n{incomplete`);
    assert.equal((await readCodexSessionBudget(file)).used, 80000);
    await appendFile(file, `}\n${row(20000)}\n`);
    assert.equal((await readCodexSessionBudget(file)).used, 20000);
    await appendFile(file, `${JSON.stringify({ type: 'compacted' })}\n`);
    assert.deepEqual(await readCodexSessionBudget(file), { used: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
