import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_PLAN_MODE,
  autoApprovedRequestIds,
  isAutoPlanMode,
  toWirePermissionMode,
  withAutoPlanMode,
} from './autoPlanMode.js';
import { decisionExitsPlanMode } from './planMode.js';

const exitPlanRequest = { requestId: 'req-1', toolName: 'ExitPlanMode' };
const bashRequest = { requestId: 'req-2', toolName: 'Bash' };
const questionRequest = { requestId: 'req-3', toolName: 'AskUserQuestion' };

test('the auto-plan mode is offered right after plan', () => {
  assert.deepEqual(
    withAutoPlanMode(['default', 'bypassPermissions', 'plan']),
    ['default', 'bypassPermissions', 'plan', AUTO_PLAN_MODE],
  );
});

test('providers missing either half do not get it', () => {
  assert.deepEqual(withAutoPlanMode(['default', 'bypassPermissions']), ['default', 'bypassPermissions']);
  assert.deepEqual(withAutoPlanMode(['default', 'plan']), ['default', 'plan']);
  assert.deepEqual(withAutoPlanMode(['default']), ['default']);
});

test('adding it twice does not duplicate the entry', () => {
  const once = withAutoPlanMode(['default', 'bypassPermissions', 'plan']);
  assert.deepEqual(withAutoPlanMode(once), once);
});

test('the backend is told plain plan, other modes pass through', () => {
  assert.equal(toWirePermissionMode(AUTO_PLAN_MODE), 'plan');
  assert.equal(toWirePermissionMode('plan'), 'plan');
  assert.equal(toWirePermissionMode('bypassPermissions'), 'bypassPermissions');
  assert.equal(toWirePermissionMode('default'), 'default');
});

test('the plan prompt is answered by the client', () => {
  assert.deepEqual(autoApprovedRequestIds(AUTO_PLAN_MODE, [exitPlanRequest]), ['req-1']);
});

test('so is every tool the approved plan then needs', () => {
  assert.deepEqual(autoApprovedRequestIds(AUTO_PLAN_MODE, [exitPlanRequest, bashRequest]), ['req-1', 'req-2']);
});

test('questions still reach the user — there is no answer to auto-fill', () => {
  assert.deepEqual(autoApprovedRequestIds(AUTO_PLAN_MODE, [questionRequest, bashRequest]), ['req-2']);
});

test('other modes keep asking', () => {
  assert.deepEqual(autoApprovedRequestIds('plan', [exitPlanRequest]), []);
  assert.deepEqual(autoApprovedRequestIds('default', [bashRequest]), []);
  assert.deepEqual(autoApprovedRequestIds('bypassPermissions', [bashRequest]), []);
  assert.equal(isAutoPlanMode('plan'), false);
  assert.equal(isAutoPlanMode(AUTO_PLAN_MODE), true);
});

test('planBypass does not exit through this helper — the send path one-shots the chip', () => {
  // Native plan still flips the chip on Build. planBypass snaps back to
  // ordinary + bypass in resetComposerModesAfterSend instead, so this helper
  // must not treat it as plan (or a late Build click would fight the reset).
  assert.equal(decisionExitsPlanMode(AUTO_PLAN_MODE, [exitPlanRequest], 'req-1', true), false);
  assert.equal(decisionExitsPlanMode('plan', [exitPlanRequest], 'req-1', true), true);
});
