import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDLE_WORK_MODE,
  idlePermissionMode,
  isIdleComposerModes,
} from './composerModeReset.js';

const ALL_MODES = ['default', 'bypassPermissions', 'plan', 'planBypass'] as const;

test('idle permission mode prefers bypass when the engine has it', () => {
  assert.equal(idlePermissionMode(ALL_MODES), 'bypassPermissions');
});

test('engines without bypass fall back to ask-always', () => {
  assert.equal(idlePermissionMode(['default', 'plan']), 'default');
  assert.equal(idlePermissionMode([]), 'default');
});

test('ordinary + bypass is already idle', () => {
  assert.equal(isIdleComposerModes('autopilot', 'bypassPermissions', ALL_MODES), true);
});

test('every one-shot chip is not idle', () => {
  assert.equal(isIdleComposerModes('checkpoints', 'bypassPermissions', ALL_MODES), false);
  assert.equal(isIdleComposerModes('interrogate', 'bypassPermissions', ALL_MODES), false);
  assert.equal(isIdleComposerModes('build', 'bypassPermissions', ALL_MODES), false);
  assert.equal(isIdleComposerModes('autopilot', 'plan', ALL_MODES), false);
  assert.equal(isIdleComposerModes('autopilot', 'planBypass', ALL_MODES), false);
  assert.equal(isIdleComposerModes('autopilot', 'default', ALL_MODES), false);
});

test('the idle work mode is ordinary, not the autopilot-build skill', () => {
  assert.equal(IDLE_WORK_MODE, 'autopilot');
  assert.notEqual(IDLE_WORK_MODE, 'build');
});
