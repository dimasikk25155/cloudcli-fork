import assert from 'node:assert/strict';
import test from 'node:test';

import { preferredStartingMode, skipPermissionsDefaultMode } from './permissionDefaults.js';

const ALL_MODES = ['default', 'bypassPermissions', 'plan'] as const;

const storageWith = (entries: Record<string, string>) => ({
  getItem: (key: string) => entries[key] ?? null,
});

test('switch on -> a chat starts in bypass', () => {
  const storage = storageWith({ 'claude-settings': JSON.stringify({ skipPermissions: true }) });
  assert.equal(skipPermissionsDefaultMode('claude', [...ALL_MODES], storage), 'bypassPermissions');
});

test('switch off -> caller falls back to the capability default', () => {
  const storage = storageWith({ 'claude-settings': JSON.stringify({ skipPermissions: false }) });
  assert.equal(skipPermissionsDefaultMode('claude', [...ALL_MODES], storage), null);
});

test('each provider reads its own switch, not another provider\'s', () => {
  const storage = storageWith({ 'claude-settings': JSON.stringify({ skipPermissions: true }) });
  assert.equal(skipPermissionsDefaultMode('cursor', [...ALL_MODES], storage), null);
});

test('a provider without the mode never gets bypass', () => {
  const storage = storageWith({ 'claude-settings': JSON.stringify({ skipPermissions: true }) });
  assert.equal(skipPermissionsDefaultMode('claude', ['default'], storage), null);
});

test('corrupt settings never widen permissions', () => {
  const storage = storageWith({ 'claude-settings': '{not json' });
  assert.equal(skipPermissionsDefaultMode('claude', [...ALL_MODES], storage), null);
});

test('no stored settings at all -> null', () => {
  assert.equal(skipPermissionsDefaultMode('claude', [...ALL_MODES], storageWith({})), null);
});

test('no storage available (SSR/tests) -> null, never bypass', () => {
  assert.equal(skipPermissionsDefaultMode('claude', [...ALL_MODES], undefined), null);
});

test('a new chat starts in bypass, with no stored settings anywhere', () => {
  assert.equal(preferredStartingMode([...ALL_MODES]), 'bypassPermissions');
});

test('an engine without bypass keeps its own default', () => {
  assert.equal(preferredStartingMode(['default', 'plan']), null);
});
