import assert from 'node:assert/strict';
import test from 'node:test';

import { codexRunPolicy, mapPermissionModeToCodexOptions } from '../codex-work-mode.js';
import { workModeInstruction } from '../work-mode.js';

test('current turn reports the resolved runtime settings, including unknown effort honestly', () => {
  const rules = codexRunPolicy('autopilot', 'default', { model: 'gpt-6.1-sol', effort: 'high' }).instructions;
  assert.match(rules, /model="gpt-6\.1-sol"; reasoning_effort="high"/);
  assert.match(rules, /THIS turn/);
  assert.match(rules, /Do not infer them from earlier messages/);
  assert.match(codexRunPolicy('autopilot', 'default', { model: 'fixture' }).instructions, /unspecified \(CLI\/model default\)/);
});

test('planning is enforced by the sandbox and stops before implementation', () => {
  assert.deepEqual(mapPermissionModeToCodexOptions('plan'), {
    sandboxMode: 'read-only', approvalPolicy: 'never',
  });
  assert.match(codexRunPolicy('autopilot', 'plan').instructions, /Do not implement/);
});

test('default uses the supported request policy and retains the workspace sandbox', () => {
  for (const mode of ['default', undefined, 'legacy-unknown']) {
    assert.deepEqual(mapPermissionModeToCodexOptions(mode), {
      sandboxMode: 'workspace-write', approvalPolicy: 'on-request',
    });
  }
});

test('auto-plan executes, while questions take priority over implementation', () => {
  assert.equal(mapPermissionModeToCodexOptions('planBypass').sandboxMode, 'danger-full-access');
  const rules = codexRunPolicy('interrogate', 'planBypass').instructions;
  assert.match(rules, /wait for the answers before implementation/);
  assert.match(rules, /STOP after asking/);
});

test('all engines ask a bounded batch and reuse prior answers', () => {
  for (const provider of ['claude', 'codex', 'grok']) {
    const rules = workModeInstruction('interrogate', 'default', provider)!;
    assert.match(rules, /2-4 important clarifying questions/);
    assert.match(rules, /do not repeat answered questions/);
  }
});

test('Codex instructions use available interfaces and include autopilot fallback', () => {
  for (const mode of ['checkpoints', 'interrogate', 'build']) {
    const rules = codexRunPolicy(mode, 'default').instructions;
    assert.doesNotMatch(rules, /AskUserQuestion|call ask_user_question|Invoke the Skill tool/);
  }
  assert.match(codexRunPolicy('build', 'default').instructions, /requirements checklist/);
  assert.match(codexRunPolicy('checkpoints', 'default').instructions, /STAGED BRIEFINGS/);
});
