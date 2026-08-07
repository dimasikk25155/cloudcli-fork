import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_WORK_MODE, WORK_MODES, normalizeWorkMode, workModeInstruction } from '@/shared/work-mode.js';

test('unknown, missing and malformed modes fall back to the default', () => {
  for (const value of [undefined, null, '', 'plan', 'AUTOPILOT', 42, {}]) {
    assert.equal(normalizeWorkMode(value), DEFAULT_WORK_MODE);
  }
});

test('every known mode survives normalization', () => {
  for (const mode of WORK_MODES) {
    assert.equal(normalizeWorkMode(mode), mode);
  }
});

test('autopilot appends nothing — it is the runtime default behaviour', () => {
  assert.equal(workModeInstruction('autopilot'), null);
  // An unknown value must be as quiet as autopilot, never accidentally
  // switching a run into a mode the user did not pick.
  assert.equal(workModeInstruction('nonsense'), null);
});

test('the interactive modes carry an instruction that names the asking tool', () => {
  for (const mode of ['checkpoints', 'interrogate']) {
    const instruction = workModeInstruction(mode);
    assert.ok(instruction && instruction.length > 0, `${mode} should produce an instruction`);
    assert.match(instruction!, /AskUserQuestion/);
  }
});
