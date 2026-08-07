import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesToolPermission } from './claude-sdk.js';

// Runtime import on purpose: a static one would drag the whole frontend tree
// into the server tsconfig (node16 resolution), which fails on src/ imports
// written for the Vite config. tsx resolves this fine at run time.
const { buildClaudeToolPermissionEntry, formatToolInputForDisplay } = await import(
  new URL('../src/components/chat/utils/chatPermissions.ts', import.meta.url).href
);

/**
 * Ties the two halves of "Allow & remember" together: the rule the UI builds
 * from a permission request must be a rule this server actually matches on the
 * next run. They live in different languages and different folders, so nothing
 * but a test keeps them in sync — and a mismatch is invisible, it just looks
 * like the button does nothing.
 */
const remembered = (toolName, input) =>
  buildClaudeToolPermissionEntry(toolName, formatToolInputForDisplay(input));

const asksAgain = (toolName, input) => {
  const entry = remembered(toolName, input);
  return !matchesToolPermission(entry, toolName, input);
};

test('remembering a plain tool stops the next prompt for it', () => {
  for (const toolName of ['Read', 'Edit', 'Write', 'mcp__playwright__browser_click']) {
    assert.equal(asksAgain(toolName, { file_path: '/tmp/a.txt' }), false, toolName);
  }
});

test('remembering a bash command stops the next prompt for the same command', () => {
  const input = { command: 'npm run build', description: 'build' };
  assert.equal(remembered('Bash', input), 'Bash(npm:*)');
  assert.equal(asksAgain('Bash', input), false);
});

test('a remembered bash rule covers other commands with the same prefix', () => {
  const entry = remembered('Bash', { command: 'npm run build' });
  assert.equal(matchesToolPermission(entry, 'Bash', { command: 'npm test' }), true);
});

test('git rules stay scoped to the subcommand that was approved', () => {
  const entry = remembered('Bash', { command: 'git status --short' });
  assert.equal(entry, 'Bash(git status:*)');
  assert.equal(matchesToolPermission(entry, 'Bash', { command: 'git status' }), true);
  assert.equal(matchesToolPermission(entry, 'Bash', { command: 'git push' }), false);
});

test('a remembered rule does not leak to a different tool', () => {
  const entry = remembered('Read', { file_path: '/tmp/a.txt' });
  assert.equal(matchesToolPermission(entry, 'Bash', { command: 'rm -rf /' }), false);
});
