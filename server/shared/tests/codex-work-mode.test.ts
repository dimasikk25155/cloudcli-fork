import assert from 'node:assert/strict';
import test from 'node:test';
import { codexRunPolicy, mapPermissionModeToCodexOptions } from '../codex-work-mode.js';
import { workModeInstruction } from '../work-mode.js';

test('planning is enforced by the sandbox and stops before implementation', () => {
  assert.deepEqual(mapPermissionModeToCodexOptions('plan'), {
    sandboxMode: 'read-only', approvalPolicy: 'never',
  });
  assert.match(codexRunPolicy('autopilot', 'plan').instructions, /Do not implement/);
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
