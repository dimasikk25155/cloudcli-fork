import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenSteps, isStepOverdue } from './stepTimer';

test('completed Codex updates close the step and cannot reopen on replay', () => {
  const steps = new OpenSteps();
  steps.update('js-1', 'js', 'in_progress', 100);
  steps.update('js-1', 'js', 'completed', 3500);
  assert.equal(steps.current(), null);
  assert.equal(isStepOverdue(steps.current(), 31 * 60_000), false);
  steps.update('js-1', 'js', 'in_progress', 4000);
  assert.equal(steps.current(), null);
});

test('parallel calls retain the oldest running step and failure closes only its call', () => {
  const steps = new OpenSteps();
  steps.update('first', 'Bash', 'in_progress', 100);
  steps.update('second', 'js', 'in_progress', 200);
  steps.update('first', 'Bash', 'failed', 300);
  assert.deepEqual(steps.current(), { name: 'js', startedAt: 200 });
  steps.finish('second');
  assert.equal(steps.current(), null);
});

test('completion received without a start never creates a phantom step', () => {
  const steps = new OpenSteps();
  for (const status of ['completed', 'failed', 'cancelled']) {
    steps.update(status, 'WebSearch', status, 100);
    assert.equal(steps.current(), null);
  }
});
