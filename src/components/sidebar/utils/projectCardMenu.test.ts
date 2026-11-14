import assert from 'node:assert/strict';
import test from 'node:test';

import { movedTooFar, projectMenuPosition } from './projectCardMenu';

test('small finger jitter keeps the hold alive', () => {
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 105, y: 107 }), false);
});

test('scrolling the list cancels the hold', () => {
  assert.equal(movedTooFar({ x: 100, y: 100 }, { x: 100, y: 120 }), true);
});

test('menu stays inside a narrow phone screen', () => {
  const viewport = { width: 360, height: 780 };
  assert.deepEqual(projectMenuPosition({ x: 350, y: 770 }, viewport), { left: 128, top: 656 });
  assert.deepEqual(projectMenuPosition({ x: 2, y: 2 }, viewport), { left: 12, top: 12 });
});

test('menu sits just under the finger when there is room', () => {
  assert.deepEqual(projectMenuPosition({ x: 120, y: 300 }, { width: 400, height: 800 }), { left: 100, top: 308 });
});
