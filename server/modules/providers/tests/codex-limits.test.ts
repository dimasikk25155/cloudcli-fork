import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createCodexUsageReader, parseCodexLimits, readCodexLimits } from '../list/codex/codex-limits.js';

test('Codex weekly-only primary does not become a five-hour limit; other buckets stay separate', () => {
  const snapshot = parseCodexLimits({ rateLimits: { limitId: 'other', primary: { usedPercent: 99, windowDurationMins: 300 } },
    rateLimitsByLimitId: { codex: { planType: 'pro', primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1794064260 }, secondary: null } },
  });
  assert.deepEqual(snapshot?.windows, [{ utilization: 5, windowMinutes: 10080, resetsAt: '2026-11-07T15:11:00.000Z' }]);
  assert.equal(snapshot?.planType, 'pro');
  assert.equal(parseCodexLimits({ rateLimits: { limitId: 'other' } }), null);
  assert.deepEqual(parseCodexLimits({ rateLimits: { primary: { usedPercent: NaN, windowDurationMins: 300 } } })?.windows, []);
  assert.deepEqual(parseCodexLimits({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 }, secondary: { usedPercent: 20, windowDurationMins: 10080 } } })?.windows.map(w => w.utilization), [0, 20]);
});

test('Codex usage reads coalesce, expire after a minute, and clear failed snapshots', async () => {
  let calls = 0;
  let time = 0;
  const reader = createCodexUsageReader(async () => {
    calls++;
    if (calls === 2) throw new Error('unavailable');
    return parseCodexLimits({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 10080 } } });
  }, () => time);
  const [a, b] = await Promise.all([reader(), reader()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await reader();
  assert.equal(calls, 1);
  time = 60001;
  assert.equal(await reader(), null);
  assert.equal(calls, 2);
});

test('Codex RPC initializes before read, never starts a thread, and closes on success/timeout', async () => {
  for (const timeout of [false, true]) {
    const requests: any[] = [];
    let killed = false;
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => { killed = true; } });
    child.stdin.on('data', (chunk) => {
      const request = JSON.parse(String(chunk)); requests.push(request);
      if (timeout) return;
      const result = request.id === 1 ? {} : { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 10080 } } };
      if (request.id) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`));
    });
    const value = await readCodexLimits({ spawnImpl: (() => child) as any, timeoutMs: 20 });
    assert.equal(killed, true);
    assert.deepEqual(requests.map(r => r.method), timeout ? ['initialize'] : ['initialize', 'initialized', 'account/rateLimits/read']);
    assert.equal(value?.windows[0].utilization ?? null, timeout ? null : 5);
  }
});
