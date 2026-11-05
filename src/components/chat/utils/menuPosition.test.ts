import assert from 'node:assert/strict';
import test from 'node:test';

import { clampMenuLeft } from './menuPosition.js';

test('a composer menu opened near the right edge is pulled back inside the window', () => {
  // Model chip of the chat on the canvas at x=1300 in a 1440px window, menu 256px wide.
  assert.equal(clampMenuLeft(1300, 256, 1440), 1440 - 256 - 8);
});

test('a menu that fits stays under its button', () => {
  assert.equal(clampMenuLeft(120, 208, 1440), 120);
});

test('never past the left edge, even when the window is narrower than the menu', () => {
  assert.equal(clampMenuLeft(-20, 176, 1440), 8);
  assert.equal(clampMenuLeft(40, 400, 320), 8);
});
