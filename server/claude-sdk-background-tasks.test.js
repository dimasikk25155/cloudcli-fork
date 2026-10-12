import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createBackgroundTaskTracker } from './modules/background-tasks/index.js';
import { isRunBusy, mapCliOptionsToSDK, stopClaudeTask } from './claude-sdk.js';

const effortModels = { OPTIONS: [], DEFAULT: 'opus[1m]' };

test('stopping a task after the turn ended (no live CLI process) says the turn is over', async () => {
  assert.deepEqual(await stopClaudeTask('no-such-session', 'task-1'), { ok: false, reason: 'turn_ended' });
});

test('every Neo3 Claude session loads the neo3-guards mod as a local SDK plugin', () => {
  const { plugins } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
  assert.equal(plugins?.length, 1);
  assert.equal(plugins[0].type, 'local');
  assert.equal(path.basename(plugins[0].path), 'neo3-guards');
  assert.ok(existsSync(path.join(plugins[0].path, '.claude-plugin', 'plugin.json')));
});

// Background tasks must not hold the CLI's stdin after `idle`: a `tail -f` or
// a dev server would keep the chat «working» forever and block the next
// message. Only an open tool call (its permission answer) holds it.
test('a live background task does not hold the run after idle', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 0 });
  tracker.apply({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'b0ckrdq1i', task_type: 'local_bash', description: 'tail -f dev.log' }],
  });
  assert.equal(isRunBusy({ openToolCalls: 0, backgroundTasks: tracker }), false);
});

test('an open tool call holds the run; nothing open releases it', () => {
  assert.equal(isRunBusy({ openToolCalls: 1 }), true);
  assert.equal(isRunBusy({ openToolCalls: 0 }), false);
});
