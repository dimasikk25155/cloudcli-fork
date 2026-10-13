import assert from 'node:assert/strict';
import test from 'node:test';

import {
  judgeForegroundLoop,
  readForegroundLoopMaxSec,
} from '../../../claude-plugins/neo3-guards/hooks/loop-rule.js';

// The rule the Claude mod (and its PreToolUse fallback) applies to every Bash
// call: a foreground wait loop that may run longer than the limit is refused.
const TEN_MINUTES_MS = 600_000;
const LIMIT_SEC = 120;

test('until-loop with sleep and a 10-minute timeout is refused with the background hint', () => {
  const verdict = judgeForegroundLoop(
    { command: 'until curl -sf http://localhost:3000; do sleep 5; done', timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.equal(verdict.deny, true);
  assert.ok(verdict.deny && verdict.reason.includes('run_in_background'));
  assert.ok(verdict.deny && verdict.reason.includes('Monitor'));
});

test('while- and for-loops with sleep are refused the same way', () => {
  const whileLoop = judgeForegroundLoop(
    { command: 'while ! test -f /tmp/done; do\n  sleep 10\ndone', timeout: 300_000 },
    LIMIT_SEC,
  );
  const forLoop = judgeForegroundLoop(
    { command: 'for i in $(seq 1 60); do gh run view 1 && break; sleep 30; done', timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.equal(whileLoop.deny, true);
  assert.equal(forLoop.deny, true);
});

test('a loop after other commands still counts', () => {
  const verdict = judgeForegroundLoop(
    { command: 'cd app && npm run deploy; until grep -q ready log.txt; do sleep 2; done', timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.equal(verdict.deny, true);
});

test('a wait loop inside ssh "…" is refused', () => {
  const verdict = judgeForegroundLoop(
    { command: "ssh vps-nl 'until systemctl is-active --quiet neo3; do sleep 5; done'", timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.equal(verdict.deny, true);
});

test('a wait loop inside bash -c "…" (and sh/zsh -c) is refused', () => {
  for (const command of [
    'bash -c "while ! curl -sf localhost:3000; do sleep 2; done"',
    "sh -c 'for i in 1 2 3; do sleep 30; done'",
    'zsh -lc "until [ -f /tmp/ok ]; do sleep 1; done" && echo ok',
  ]) {
    assert.equal(judgeForegroundLoop({ command, timeout: TEN_MINUTES_MS }, LIMIT_SEC).deny, true, command);
  }
});

test('quoted text that is not a shell script stays data', () => {
  const verdict = judgeForegroundLoop(
    { command: "echo 'until x; do sleep 5; done' > notes.txt", timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.deepEqual(verdict, { deny: false });
});

test('a sleep after the loop (outside do … done) is not a wait loop', () => {
  for (const command of [
    'for f in a b; do echo $f; done; sleep 200',
    'while read line; do echo "$line"; done < list.txt && sleep 150',
  ]) {
    assert.deepEqual(judgeForegroundLoop({ command, timeout: TEN_MINUTES_MS }, LIMIT_SEC), { deny: false }, command);
  }
});

test('a sleep in a nested loop body still counts', () => {
  const verdict = judgeForegroundLoop(
    { command: 'for host in a b; do while ! ping -c1 $host; do sleep 3; done; done', timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.equal(verdict.deny, true);
});

test('the same loop in the background is allowed', () => {
  const verdict = judgeForegroundLoop(
    { command: 'until curl -sf http://localhost:3000; do sleep 5; done', timeout: TEN_MINUTES_MS, run_in_background: true },
    LIMIT_SEC,
  );
  assert.deepEqual(verdict, { deny: false });
});

test('without an explicit timeout the Bash default (2 min) is not above the default limit', () => {
  const verdict = judgeForegroundLoop(
    { command: 'until test -f out.json; do sleep 3; done' },
    LIMIT_SEC,
  );
  assert.deepEqual(verdict, { deny: false });
});

test('without an explicit timeout a lower limit refuses the loop (default Bash timeout is 2 min)', () => {
  const verdict = judgeForegroundLoop(
    { command: 'until test -f out.json; do sleep 3; done' },
    60,
  );
  assert.equal(verdict.deny, true);
});

test('a timeout at or under the limit is allowed', () => {
  const verdict = judgeForegroundLoop(
    { command: 'while true; do sleep 1; done', timeout: 90_000 },
    LIMIT_SEC,
  );
  assert.deepEqual(verdict, { deny: false });
});

test('a loop without sleep is not a wait loop', () => {
  const verdict = judgeForegroundLoop(
    { command: 'for f in *.png; do convert "$f" "${f%.png}.webp"; done', timeout: TEN_MINUTES_MS },
    LIMIT_SEC,
  );
  assert.deepEqual(verdict, { deny: false });
});

test('ordinary commands are allowed, even long ones and ones mentioning the words', () => {
  for (const command of [
    'npm test',
    'sleep 300',
    'echo "waiting for the build"; sleep 5',
    'git log --format="%h while %s" -n 5',
    'grep -rn "until" src/ && grep -rn "sleep" src/',
  ]) {
    assert.deepEqual(
      judgeForegroundLoop({ command, timeout: TEN_MINUTES_MS }, LIMIT_SEC),
      { deny: false },
      command,
    );
  }
});

test('the limit comes from NEO3_FOREGROUND_LOOP_MAX_SEC, 120 s when unset or invalid', () => {
  assert.equal(readForegroundLoopMaxSec(undefined), 120);
  assert.equal(readForegroundLoopMaxSec(''), 120);
  assert.equal(readForegroundLoopMaxSec('abc'), 120);
  assert.equal(readForegroundLoopMaxSec('-5'), 120);
  assert.equal(readForegroundLoopMaxSec('300'), 300);
});
