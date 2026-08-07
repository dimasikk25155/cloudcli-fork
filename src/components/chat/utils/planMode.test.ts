import assert from 'node:assert/strict';
import test from 'node:test';

import { decisionExitsPlanMode, permissionModeAfterPlanApproval } from './planMode.js';

const exitPlanRequest = { requestId: 'req-1', toolName: 'ExitPlanMode' };
const bashRequest = { requestId: 'req-2', toolName: 'Bash' };

test('accepting the plan ends plan mode', () => {
  assert.equal(decisionExitsPlanMode('plan', [exitPlanRequest], 'req-1', true), true);
});

test('the snake_case tool id counts too', () => {
  const request = { requestId: 'req-3', toolName: 'exit_plan_mode' };
  assert.equal(decisionExitsPlanMode('plan', [request], 'req-3', true), true);
});

test('asking to revise the plan keeps plan mode', () => {
  assert.equal(decisionExitsPlanMode('plan', [exitPlanRequest], 'req-1', false), false);
});

test('approving an ordinary tool never leaves plan mode', () => {
  assert.equal(decisionExitsPlanMode('plan', [bashRequest], 'req-2', true), false);
});

test('a bulk approval that includes the plan still exits', () => {
  assert.equal(
    decisionExitsPlanMode('plan', [bashRequest, exitPlanRequest], ['req-2', 'req-1'], true),
    true,
  );
});

test('outside plan mode there is nothing to switch back from', () => {
  assert.equal(decisionExitsPlanMode('default', [exitPlanRequest], 'req-1', true), false);
});

test('an approved plan runs in bypass, not back in ask-mode', () => {
  assert.equal(
    permissionModeAfterPlanApproval(['default', 'bypassPermissions', 'plan']),
    'bypassPermissions',
  );
});

test('providers without a bypass mode fall back to default', () => {
  assert.equal(permissionModeAfterPlanApproval(['default', 'plan']), 'default');
  assert.equal(permissionModeAfterPlanApproval([]), 'default');
});
