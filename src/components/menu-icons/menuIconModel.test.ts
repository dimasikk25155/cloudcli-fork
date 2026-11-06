import assert from 'node:assert/strict';
import test from 'node:test';

import { LAUNCHER_GRADIENTS } from '../workbench/newTabModel';

import { MENU_ICON_KEYS, isMenuIconKey, menuTileFor } from './menuIconModel';

// The sidebar menu as the old mobile row showed it (spec R07i), in that order.
const EXPECTED_KEYS = [
  'nightshift', 'consigliere', 'mazda', 'agent-workspace', 'schedules', 'pipelines',
  'governance', 'server', 'duet', 'agents', 'queue', 'krabik', 'settings',
];

test('the menu icon set covers all 13 sidebar entries in menu order', () => {
  assert.deepEqual([...MENU_ICON_KEYS], EXPECTED_KEYS);
});

test('isMenuIconKey accepts the 13 keys and nothing else', () => {
  for (const key of EXPECTED_KEYS) assert.equal(isMenuIconKey(key), true, key);
  for (const key of ['', 'telegram', 'Settings', 'plugin']) assert.equal(isMenuIconKey(key), false, key);
});

test('every tile uses a launcher gradient, and no two tiles share one', () => {
  const palette = new Set<string>(Object.values(LAUNCHER_GRADIENTS));
  const gradients = MENU_ICON_KEYS.map((key) => menuTileFor(key).gradient);
  for (const gradient of gradients) {
    assert.match(gradient, /^linear-gradient\(180deg, #[0-9A-F]{6} 0%, #[0-9A-F]{6} 100%\)$/i);
    assert.ok(palette.has(gradient), `${gradient} is not from LAUNCHER_GRADIENTS`);
  }
  assert.equal(new Set(gradients).size, 13);
});
