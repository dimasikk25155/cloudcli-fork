import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readGrokContextBudget,
  scanGrokTurnUsage,
} from '@/shared/grok-usage.js';
import { snapshotToComposerBudget, type SessionCostSnapshot } from '@/shared/session-usage.js';

async function withGrokHome(run: (root: string) => Promise<void>): Promise<void> {
  const previous = process.env.GROK_HOME;
  const root = await mkdtemp(path.join(os.tmpdir(), 'grok-usage-'));
  process.env.GROK_HOME = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = previous;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('signals.json is the context-window fill, not the spend total', async () => {
  await withGrokHome(async (root) => {
    const cwd = '/tmp/demo';
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const dir = path.join(root, 'sessions', encodeURIComponent(cwd), sessionId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'signals.json'), JSON.stringify({
      contextTokensUsed: 125_677,
      contextWindowTokens: 500_000,
      primaryModelId: 'grok-4.6',
    }));

    const budget = readGrokContextBudget(cwd, sessionId, 'grok-4.6');
    assert.equal(budget?.used, 125_677);
    assert.equal(budget?.total, 500_000);
    assert.equal(budget?.model, 'grok-4.6');
  });
});

test('turn_completed rows are per-turn spend, not a window fill', async () => {
  await withGrokHome(async (root) => {
    const updates = path.join(root, 'updates.jsonl');
    const rows = [
      {
        timestamp: 1_787_574_000,
        method: '_x.ai/session/update',
        params: {
          sessionId: 'abc',
          update: {
            sessionUpdate: 'turn_completed',
            usage: {
              inputTokens: 953_196,
              outputTokens: 17_491,
              cachedReadTokens: 790_656,
              modelUsage: { 'grok-4.6-build': {} },
            },
          },
        },
      },
      {
        timestamp: 1_787_574_100,
        method: '_x.ai/session/update',
        params: {
          sessionId: 'abc',
          update: {
            sessionUpdate: 'turn_completed',
            usage: {
              inputTokens: 107_686,
              outputTokens: 868,
              cachedReadTokens: 105_600,
              modelUsage: { 'grok-4.6-build': {} },
            },
          },
        },
      },
    ];
    await writeFile(updates, rows.map((row) => JSON.stringify(row)).join('\n'));

    const turns = await scanGrokTurnUsage(updates);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].breakdown.freshInput, 953_196 - 790_656);
    assert.equal(turns[0].breakdown.cacheRead, 790_656);
    assert.equal(turns[1].breakdown.output, 868);
    assert.equal(turns[0].model, 'grok-4.6-build');
  });
});

test('composer budget keeps window fill separate from session spend', () => {
  const snapshot: SessionCostSnapshot = {
    model: 'grok-4.6',
    inputTokens: 3_394_634,
    outputTokens: 47_460,
    cacheReadTokens: 3_055_872,
    cacheCreationTokens: 0,
    totalTokens: 3_394_634 + 47_460,
    contextTokens: 135_301,
    contextWindow: 500_000,
    costUsd: 2.49,
    transcriptPath: '/tmp/updates.jsonl',
  };
  const budget = snapshotToComposerBudget(snapshot);
  assert.equal(budget.used, 135_301);
  assert.equal(budget.total, 500_000);
  assert.equal(budget.inputTokens, 3_394_634);
  assert.equal(budget.outputTokens, 47_460);
  assert.ok(Number(budget.used) < Number(budget.total));
});
