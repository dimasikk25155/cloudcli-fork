import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createCodexBackgroundTaskTracker } from '@/modules/providers/list/codex/codex-background-tasks.js';

/**
 * «Фон: N» for Codex. Codex runs every command in a unified-exec session; a
 * command still running when the model speaks again (a reasoning or message
 * item completes) has been left to run in the background — the model went
 * on without its result. It ends with its own `item.completed`.
 *
 * codex-background-live.jsonl — one turn of a real Codex SDK rollout
 * (~/.codex/sessions/2026/11/04, `codex_sdk_ts`): item ids, order and
 * timing are the rollout's; command texts, reasoning and messages replaced.
 * The rollout keeps only completed items with their duration, so each
 * command's `item.started` is placed at «completed − duration» in the SDK
 * `--experimental-json` envelope. Three commands outlive a model step:
 * A (347 s, ends last), B (fails 0.3 s after the step) and C (13 s).
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const A = 'exec-9835e7b9-d403-49d9-8132-6fbc4ad540eb';
const B = 'exec-6b53f6b1-8184-42d5-aaf0-00a12689c746';
const C = 'exec-bf845d6a-d2cb-4e09-835b-40ea634878ee';

async function loadLines(name: string): Promise<unknown[]> {
  const text = await readFile(path.join(FIXTURES, name), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('commands left running behind a model step come and go; plain commands never show', async () => {
  const tracker = createCodexBackgroundTaskTracker({ now: () => 7_000 });
  const changes: string[][] = [];
  for (const line of await loadLines('codex-background-live.jsonl')) {
    const tasks = tracker.apply(line);
    if (tasks) changes.push(tasks.map((task) => task.taskId));
  }
  // Worked out from the rollout timeline by hand: A is behind the first
  // reasoning; B joins and fails right after; C joins and finishes; A ends.
  assert.deepEqual(changes, [[A], [A, B], [A], [A, C], [A], []]);
  assert.equal(tracker.list().length, 0);
});

test('a background command is a bash task described by its script, with its command kept for «Стоп»', () => {
  const tracker = createCodexBackgroundTaskTracker({ now: () => 42 });
  tracker.apply({ type: 'item.started', item: { id: 'exec-1', type: 'command_execution',
    command: "/bin/zsh -lc 'npm run dev'", aggregated_output: '', status: 'in_progress' } });
  assert.equal(tracker.has('exec-1'), false, 'not background until the model moves on');
  const tasks = tracker.apply({ type: 'item.completed', item: { id: 'rs_1', type: 'reasoning', text: '' } });
  assert.deepEqual(tasks, [{ taskId: 'exec-1', kind: 'bash', description: 'npm run dev', startedAt: 42, toolUseId: 'exec-1' }]);
  assert.equal(tracker.commandOf('exec-1'), 'npm run dev');
  assert.equal(tracker.commandOf('missing'), null);

  // Parallel commands of one step finish before the next reasoning: no task.
  tracker.apply({ type: 'item.started', item: { id: 'exec-2', type: 'command_execution', command: 'ls', status: 'in_progress' } });
  tracker.apply({ type: 'item.completed', item: { id: 'exec-2', type: 'command_execution', command: 'ls', status: 'completed', exit_code: 0 } });
  assert.equal(tracker.apply({ type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text: 'Готово' } }), null);
  // Garbage never throws and never changes the list.
  for (const line of [null, 'text', {}, { type: 'item.completed' }, { type: 'item.completed', item: { type: 'command_execution' } }]) {
    assert.equal(tracker.apply(line), null);
  }
  assert.deepEqual(tracker.list().map((task) => task.taskId), ['exec-1']);
});

test('the codex exec process of a run is picked by its folder and thread, never another chat\'s', async () => {
  const { pickCodexExecProcess } = await import('@/modules/providers/list/codex/codex-background-tasks.js');
  const exec = (pid: number, rest: string) => ({ pid, command: `/opt/codex/codex exec --experimental-json --model gpt --cd /work/a ${rest}` });
  const candidates = [exec(10, 'resume thread-1'), exec(11, ''), { pid: 12, command: '/opt/codex/codex exec --experimental-json --cd /work/b' }];
  assert.equal(pickCodexExecProcess(candidates, { workingDirectory: '/work/a', threadId: 'thread-1', claimed: new Set() }), 10);
  // A brand-new thread has no id in its arguments: the one unclaimed new run in that folder.
  assert.equal(pickCodexExecProcess(candidates, { workingDirectory: '/work/a', threadId: null, claimed: new Set() }), 11);
  assert.equal(pickCodexExecProcess(candidates, { workingDirectory: '/work/b', threadId: null, claimed: new Set() }), 12);
  // Two new runs in one folder — cannot tell which is ours: none.
  assert.equal(pickCodexExecProcess([...candidates, exec(13, '')], { workingDirectory: '/work/a', threadId: null, claimed: new Set() }), null);
  assert.equal(pickCodexExecProcess([...candidates, exec(13, '')], { workingDirectory: '/work/a', threadId: null, claimed: new Set([13]) }), 11);
  assert.equal(pickCodexExecProcess(candidates, { workingDirectory: '/work/c', threadId: null, claimed: new Set() }), null);
});

test('without reasoning items, the next step starting while a command runs makes it background', () => {
  // Order seen in a live isolated Codex run (04.11, no reasoning emitted):
  // `sleep 90` started, ~10 s later the model's next step started `echo second`.
  let clock = 0;
  const tracker = createCodexBackgroundTaskTracker({ now: () => clock });
  const started = (id: string, command: string) => ({ type: 'item.started', item: { id, type: 'command_execution', command, status: 'in_progress' } });
  assert.equal(tracker.apply(started('exec-sleep', "/bin/zsh -lc 'sleep 90; echo first-done'")), null);
  clock = 50;
  // A command of the same step (parallel, 50 ms later) — the first one is not background yet.
  assert.equal(tracker.apply(started('exec-par', "/bin/zsh -lc 'ls'")), null);
  tracker.apply({ type: 'item.completed', item: { id: 'exec-par', type: 'command_execution', command: 'ls', status: 'completed' } });
  clock = 10_400;
  assert.deepEqual(tracker.apply(started('exec-echo', "/bin/zsh -lc 'echo second'"))?.map((task) => task.taskId), ['exec-sleep']);
  assert.equal(tracker.has('exec-echo'), false, 'the new step itself is not background');
});
