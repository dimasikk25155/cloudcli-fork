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

test('the terminal tile stays visibly lighter than the dark canvas (about #151517)', () => {
  const hexes = launcherStyleFor('terminal').gradient.match(/#[0-9A-Fa-f]{6}/g) ?? [];
  assert.equal(hexes.length, 2);
  const luma = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Canvas luma is ~21; the darkest end of the tile must clear it clearly, and the top must stay a lit graphite.
  assert.ok(luma(hexes[1]) >= 36, `bottom ${hexes[1]} too dark`);
  assert.ok(luma(hexes[0]) >= 60, `top ${hexes[0]} too dark`);
});

test('«Safari» has its own compass tile, not the neutral fallback', () => {
  const style = launcherStyleFor('safari');
  assert.notDeepEqual(style, launcherStyleFor('plugin'));
  assert.match(style.gradient, /^linear-gradient\(/);
});
