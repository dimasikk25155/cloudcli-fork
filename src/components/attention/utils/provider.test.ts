import assert from 'node:assert/strict';
import test from 'node:test';

import { knownProvider } from './provider';

test('server provider strings narrow to a known engine by check, unknown ones stay unknown', () => {
  assert.equal(knownProvider('grok'), 'grok');
  assert.equal(knownProvider('claude'), 'claude');
  assert.equal(knownProvider('codex'), 'codex');
  assert.equal(knownProvider('unknown'), null);
  assert.equal(knownProvider('Grok'), null);
  assert.equal(knownProvider(''), null);
});
