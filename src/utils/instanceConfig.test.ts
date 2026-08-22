import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultClaudeModel, isFlagOn } from './instanceConfig.js';

test('no VITE_DEFAULT_CLAUDE_MODEL -> the previous default, untouched', () => {
  assert.equal(defaultClaudeModel('default', undefined), 'default');
});

test('blank VITE_DEFAULT_CLAUDE_MODEL -> the previous default, untouched', () => {
  assert.equal(defaultClaudeModel('default', ''), 'default');
  assert.equal(defaultClaudeModel('default', '   '), 'default');
});

test('VITE_DEFAULT_CLAUDE_MODEL set -> a new chat starts on that model', () => {
  assert.equal(defaultClaudeModel('default', 'local-qwen35-9b'), 'local-qwen35-9b');
});

test('stray whitespace around the model id is ignored', () => {
  assert.equal(defaultClaudeModel('default', ' local-qwen35-9b\n'), 'local-qwen35-9b');
});

test('no VITE_HIDE_PROJECTS -> the project list stays', () => {
  assert.equal(isFlagOn(undefined), false);
  assert.equal(isFlagOn(''), false);
});

test('VITE_HIDE_PROJECTS=1 (or true) -> the project list is hidden', () => {
  assert.equal(isFlagOn('1'), true);
  assert.equal(isFlagOn('true'), true);
  assert.equal(isFlagOn(' TRUE '), true);
});

test('anything that is not an explicit yes leaves the project list alone', () => {
  assert.equal(isFlagOn('0'), false);
  assert.equal(isFlagOn('false'), false);
  assert.equal(isFlagOn('yes'), false);
});
