import assert from 'node:assert/strict';
import test from 'node:test';

import { mergePermissionListOnSave } from './mergePermissionLists.js';

test('a rule remembered from the chat survives saving the settings page', () => {
  // Settings opened with ['Read'], user changed nothing there, meanwhile
  // "Allow & remember" in a chat added Bash(npm:*) to the same storage key.
  const merged = mergePermissionListOnSave(['Read'], ['Read'], ['Read', 'Bash(npm:*)']);
  assert.deepEqual(merged, ['Read', 'Bash(npm:*)']);
});

test('removing a rule on the settings page still removes it', () => {
  const merged = mergePermissionListOnSave(['Read', 'Edit'], ['Read'], ['Read', 'Edit']);
  assert.deepEqual(merged, ['Read']);
});

test('a rule added on the settings page is kept', () => {
  const merged = mergePermissionListOnSave([], ['Write'], []);
  assert.deepEqual(merged, ['Write']);
});

test('removing here wins over a concurrent write of the same entry', () => {
  const merged = mergePermissionListOnSave(['Bash(rm:*)'], [], ['Bash(rm:*)', 'Read']);
  assert.deepEqual(merged, ['Read']);
});

test('no duplicates when both sides have the same entry', () => {
  const merged = mergePermissionListOnSave(['Read'], ['Read', 'Edit'], ['Read', 'Edit']);
  assert.deepEqual(merged, ['Read', 'Edit']);
});
