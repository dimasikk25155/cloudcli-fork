import assert from 'node:assert/strict';
import test from 'node:test';

import { launcherStyleFor } from './newTabModel.js';
import type { WorkbenchTabKind } from './workbenchTabs.js';

// Every kind the «+» menu / new tab can offer (projectTabs, builtinTabs, side chats, artifacts) plus the rest of the canvas.
const MENU_KINDS: WorkbenchTabKind[] = ['inspector', 'limits', 'artifacts', 'chat', 'terminal', 'files', 'stats', 'autopilot', 'plugin'];
const OTHER_KINDS: WorkbenchTabKind[] = ['btw', 'advisor', 'report', 'artifact'];

test('every kind gets a big icon and a gradient tile', () => {
  for (const kind of [...MENU_KINDS, ...OTHER_KINDS]) {
    const style = launcherStyleFor(kind);
    assert.ok(style.Icon, `${kind}: no icon`);
    assert.match(style.gradient, /^linear-gradient\(/, `${kind}: not a gradient`);
  }
});

test('each family has its own colour; the two chats share green', () => {
  const families = ['inspector', 'limits', 'artifacts', 'chat', 'advisor', 'terminal', 'files', 'stats', 'autopilot', 'report', 'plugin'] as const;
  const gradients = families.map((kind) => launcherStyleFor(kind).gradient);
  assert.equal(new Set(gradients).size, families.length);
  assert.equal(launcherStyleFor('btw').gradient, launcherStyleFor('chat').gradient);
});

test('a plugin and an unknown kind get the neutral fallback', () => {
  const fallback = launcherStyleFor('plugin', 'weather');
  assert.deepEqual(launcherStyleFor('from-a-newer-neo3' as WorkbenchTabKind), fallback);
  assert.deepEqual(launcherStyleFor('plugin', 'another'), fallback);
});
