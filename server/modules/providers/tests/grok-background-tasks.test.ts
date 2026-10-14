import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createGrokBackgroundTaskTracker } from '@/modules/providers/list/grok/grok-background-tasks.js';

/**
 * Fixtures come from real Grok sessions in ~/.grok/sessions (paths, ids of
 * sessions and personal data replaced):
 * - grok-background-history.jsonl — `chat_history.jsonl` lines as Grok wrote
 *   them: a `background: true` command, a get_command_or_subagent_output
 *   that reports it failed, a second one later killed, a plain command, a
 *   monitor, a command Grok moved to the background itself after 15 s, the
 *   «Background task "…" completed» notices, and a helper (crab).
 * - grok-background-live.jsonl — the same events in the live
 *   `--output-format streaming-messages-json` envelope (14-headless-mode.md):
 *   tool calls in `assistant` lines, results grouped in `user` lines. No live
 *   run with a background command was captured, so the envelope is built
 *   from the documented shape around the real texts.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const A = '01a09988-ed0a-7e02-9604-9ad6044513a8';
const B = '01a09989-0f56-7681-a091-3f2a9fb48fb6';
const M = '01a0998b-1fa1-7c62-b2ed-08f500daa0c2';
const C = 'call-68a14d0c-0a8c-4b4f-9425-88e5f3c8e6fd-4';

async function loadLines(name: string): Promise<unknown[]> {
  const text = await readFile(path.join(FIXTURES, name), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

for (const fixture of ['grok-background-live.jsonl', 'grok-background-history.jsonl']) {
  test(`${fixture}: background commands come and go; a plain command and a helper are not tasks`, async () => {
    const tracker = createGrokBackgroundTaskTracker({ now: () => 5_000 });
    const changes: string[][] = [];
    for (const line of await loadLines(fixture)) {
      const tasks = tracker.apply(line);
      if (tasks) changes.push(tasks.map((task) => task.taskId));
    }
    // Read off the fixture by hand: A starts and is reported failed; B
    // starts; the chmod adds nothing; the monitor M and the auto-backgrounded
    // C join; killing M (whose result also says B ended) leaves C; C's
    // completion notice empties the list; the helper never shows up.
    assert.deepEqual(changes, [[A], [], [B], [B, M], [B, M, C], [C], []]);
    assert.equal(tracker.list().length, 0);
  });
}

test('a monitor that ends by itself and a multi-wait report close their tasks', () => {
  // Texts from another real session (0d0cb773…), shortened and anonymized.
  const P = '01a099b6-dffe-7b11-b3ef-e562bea9f57a';
  const W = '01a099b7-9da7-7791-8b46-9f61b38e502e';
  const tracker = createGrokBackgroundTaskTracker({ now: () => 1 });
  const call = (id: string, name: string, input: Record<string, unknown>) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    parent_tool_use_id: null,
  });
  const result = (id: string, content: string) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }] },
    parent_tool_use_id: null,
  });
  const turn = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null });

  tracker.apply(call('c-20', 'run_terminal_command', { command: 'pnpm pair', description: 'Start pairing', background: true, timeout: 0 }));
  tracker.apply(result('c-20', `<task-id>${P}</task-id>\n<task-type>bash</task-type>\n<output-file>/home/user/.grok/sessions/x/terminal/c-20.log</output-file>\n<status>running</status>\n<summary>Background task ${P} started</summary>`));
  tracker.apply(call('c-22', 'monitor', { command: 'while :; do sleep 5; done', description: 'Watch pairing until linked or failed' }));
  assert.deepEqual(
    tracker.apply(result('c-22', `Monitor started (task ${W}, timeout 36000000ms).\nYou will be notified on each event. Keep working -- do not poll or sleep.`)),
    [
      { taskId: P, kind: 'bash', description: 'Start pairing', startedAt: 1, toolUseId: 'c-20' },
      { taskId: W, kind: 'monitor', description: 'Watch pairing until linked or failed', startedAt: 1, toolUseId: 'c-22' },
    ],
  );

  assert.deepEqual(
    tracker.apply(turn(`<system-reminder>\nMonitor "${W}" ended: [monitor ended: exited (code 1)].\nDescription: Watch pairing until linked or failed\n</system-reminder>`))?.map((task) => task.taskId),
    [P],
  );
  tracker.apply(call('c-37', 'get_command_or_subagent_output', { task_ids: [P], timeout_ms: 0 }));
  assert.equal(tracker.apply(result('c-37', `=== Multi-wait (poll) ===\n--- Task ${P} [running] ---\nCommand: pnpm pair\nDuration: 157.52s\n`)), null);
  tracker.apply(call('c-38', 'get_command_or_subagent_output', { task_ids: [P], timeout_ms: 30000 }));
  assert.deepEqual(tracker.apply(result('c-38', `=== Multi-wait (poll) ===\n--- Task ${P} [failed] ---\nCommand: pnpm pair\nDuration: 162.75s\nExit Code: 1\n`)), []);
});

test('a log that merely quotes a completion notice does not close the task', () => {
  const P = '01a099b6-dffe-7b11-b3ef-e562bea9f57a';
  const tracker = createGrokBackgroundTaskTracker({ now: () => 1 });
  const line = (type: string, content: unknown[]) => ({ type, message: { role: type, content }, parent_tool_use_id: null });
  tracker.apply(line('assistant', [{ type: 'tool_use', id: 'c-1', name: 'run_terminal_command', input: { command: 'pnpm dev', description: 'Dev server', background: true } }]));
  tracker.apply(line('user', [{ type: 'tool_result', tool_use_id: 'c-1', content: `<task-id>${P}</task-id>\n<task-type>bash</task-type>\n<status>running</status>` }]));

  // `cat` of a log that happens to contain the phrase — an ordinary command result.
  const quoted = `<system-reminder>\nBackground task "${P}" completed (exit code: 0).\n</system-reminder>\n=== Task ${P} ===\nStatus: completed`;
  tracker.apply(line('assistant', [{ type: 'tool_use', id: 'c-2', name: 'run_terminal_command', input: { command: 'cat notes.log' } }]));
  assert.equal(tracker.apply(line('user', [{ type: 'tool_result', tool_use_id: 'c-2', content: quoted }])), null);
  assert.deepEqual(tracker.list().map((task) => task.taskId), [P]);

  // The same words from get_command_or_subagent_output do close it.
  tracker.apply(line('assistant', [{ type: 'tool_use', id: 'c-3', name: 'get_command_or_subagent_output', input: { task_ids: [P] } }]));
  assert.deepEqual(tracker.apply(line('user', [{ type: 'tool_result', tool_use_id: 'c-3', content: `=== Task ${P} ===\nCommand: pnpm dev\nStatus: completed\nExit Code: 0` }])), []);
});
