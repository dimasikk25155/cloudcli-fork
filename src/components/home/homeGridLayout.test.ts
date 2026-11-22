import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_CELL_HEIGHT, holdGridSize, homeGridLayout } from './homeGridLayout.js';

test('a Home cell is the 68 px tile, an 8 px gap and two label lines', () => {
  assert.equal(HOME_CELL_HEIGHT, 106);
});

test('iPhone width: four columns with the phone gaps', () => {
  // 390 px screen − 2 × 24 px padding = 342 px of grid.
  const layout = homeGridLayout({ width: 342, height: 553 });
  assert.equal(layout.columns, 4);
  assert.equal(layout.columnGap, 16);
  assert.equal(layout.rowGap, 24);
  // 4 rows take 4 × 106 + 3 × 24 = 496 px; a fifth would need 626.
  assert.equal(layout.rows, 4);
  assert.equal(layout.capacity, 16);
});

test('rows are whole: one pixel short of a row drops it', () => {
  assert.equal(homeGridLayout({ width: 342, height: 4 * 106 + 3 * 24 }).rows, 4);
  assert.equal(homeGridLayout({ width: 342, height: 4 * 106 + 3 * 24 - 1 }).rows, 3);
});

test('wider grids take 6, 8 and 10 columns', () => {
  assert.equal(homeGridLayout({ width: 704, height: 600 }).columns, 6);
  assert.equal(homeGridLayout({ width: 912, height: 600 }).columns, 8);
  const desktop = homeGridLayout({ width: 1072, height: 560 });
  assert.equal(desktop.columns, 10);
  assert.equal(desktop.columnGap, 20);
  assert.equal(desktop.rowGap, 28);
  // 4 × 106 + 3 × 28 = 508 ≤ 560 < 5 × 106 + 4 × 28 = 642.
  assert.equal(desktop.rows, 4);
  assert.equal(desktop.capacity, 40);
});

test('at least one row, and four columns before the first measurement', () => {
  const tiny = homeGridLayout({ width: 0, height: 0 });
  assert.equal(tiny.columns, 4);
  assert.equal(tiny.rows, 1);
  assert.equal(tiny.capacity, 4);
  assert.equal(homeGridLayout({ width: 342, height: 40 }).rows, 1);
});

test('search focused on an iPhone: the keyboard does not take rows away', () => {
  // 390 px phone before the tap: 553 px of grid, 4 rows. The keyboard (~336 px)
  // leaves ~217 px — on its own that would be one row.
  const before = { width: 342, height: 553 };
  const withKeyboard = { width: 342, height: 217 };
  assert.equal(homeGridLayout(withKeyboard).rows, 1);

  const held = holdGridSize(withKeyboard, before);
  assert.deepEqual(held, { width: 342, height: 553 });
  assert.equal(homeGridLayout(held).capacity, 16);
});

test('holding keeps the taller size and follows the width', () => {
  // Rotated to landscape while the keyboard is up: columns follow the width.
  assert.deepEqual(holdGridSize({ width: 700, height: 120 }, { width: 342, height: 553 }), { width: 700, height: 553 });
  // The area grew while held (keyboard closing) — the larger size wins.
  assert.deepEqual(holdGridSize({ width: 342, height: 600 }, { width: 342, height: 553 }), { width: 342, height: 600 });
  // Nothing held — the measurement as is.
  assert.deepEqual(holdGridSize({ width: 342, height: 217 }, null), { width: 342, height: 217 });
});
