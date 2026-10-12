import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { mapCliOptionsToSDK, stopClaudeTask } from './claude-sdk.js';

const effortModels = { OPTIONS: [], DEFAULT: 'opus[1m]' };

test('stopping a task of a session with no live CLI process says the task is no longer running', async () => {
  assert.deepEqual(await stopClaudeTask('no-such-session', 'task-1'), { ok: false, reason: 'not_running' });
});

test('every Neo3 Claude session loads the neo3-guards mod as a local SDK plugin', () => {
  const { plugins } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
  assert.equal(plugins?.length, 1);
  assert.equal(plugins[0].type, 'local');
  assert.equal(path.basename(plugins[0].path), 'neo3-guards');
  assert.ok(existsSync(path.join(plugins[0].path, '.claude-plugin', 'plugin.json')));
});
