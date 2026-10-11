import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs the hook exactly as Claude Code does: plain `node` (no tsx, no build),
// hook JSON on stdin, decision JSON on stdout. Run with:
//   node --test scripts/hooks/secret-guard.test.mjs
// Key values are fakes of the right shape.

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'secret-guard.mjs');
const FAKE_KEY = 'sk-ant-api03-FakeFakeFakeFakeFakeFakeFake0000';

function runHook(input, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (!('NEO3_SESSION' in env)) delete childEnv.NEO3_SESSION;
  return spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: childEnv,
    encoding: 'utf8',
  });
}

const hookInput = (prompt) => ({
  session_id: 'test-session',
  transcript_path: '/tmp/none.jsonl',
  cwd: '/tmp',
  hook_event_name: 'UserPromptSubmit',
  prompt,
});

test('a prompt with a key is blocked, the reason names the kind but not the value', () => {
  const result = runHook(hookInput(`подключи апи, ключ ANTHROPIC_API_KEY=${FAKE_KEY}`));

  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /Anthropic/);
  assert.match(decision.reason, /\.secrets\.env/);
  assert.ok(!result.stdout.includes(FAKE_KEY), 'the value must never be echoed');
  assert.ok(!result.stderr.includes(FAKE_KEY), 'nor written to stderr');
});

test('a clean prompt passes: exit 0, no output', () => {
  const result = runHook(hookInput('Откатись на коммит 3f9a2c7 и прогони тесты'));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('inside a Neo3 session (NEO3_SESSION=1) the hook stays silent even with a key', () => {
  const result = runHook(hookInput(`ключ ${FAKE_KEY}`), { NEO3_SESSION: '1' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('broken stdin never blocks the terminal', () => {
  for (const input of ['not json', '', JSON.stringify({ hook_event_name: 'UserPromptSubmit' })]) {
    const result = runHook(input);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
});
