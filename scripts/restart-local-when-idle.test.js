import assert from 'node:assert/strict';
import test from 'node:test';
import { directChildren, waitForIdle } from './restart-local-when-idle.js';

test('restart guard includes Codex, wrappers and unknown children but ignores unrelated apps', () => {
  assert.deepEqual(directChildren('10 1 /node\n20 10 /vendor/bin/codex\n21 10 /node\n22 20 /bin/zsh\n30 1 /Applications/ChatGPT/codex\n', 10).map((child) => child.pid), [20, 21]);
  assert.throws(() => directChildren('invalid process output', 10));
});

test('a new request during delivery grace resets the idle timer', async () => {
  let clock = 0;
  const states = [[1], [], [], [2], [], [], [], [], [], []];
  let observations = 0;
  await waitForIdle({
    sample: () => states[observations++] || [], now: () => clock,
    sleep: async (ms) => { clock += ms; }, timeoutMs: 20_000, graceMs: 5_000,
  });
  assert.equal(clock, 9_000);
  assert.equal(observations, 10);
});

test('persistent activity times out and failed status inspection never means idle', async () => {
  let clock = 0;
  await assert.rejects(waitForIdle({ sample: () => [1], now: () => clock, sleep: async (ms) => { clock += ms; }, timeoutMs: 3_000 }), /Timed out/);
  await assert.rejects(waitForIdle({ sample: () => { throw new Error('ps failed'); } }), /ps failed/);
});
