import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_CELL_HEIGHT, holdGridSize, homeGridLayout, nextGridHold } from './homeGridLayout.js';

test('a Home cell is the 68 px tile, an 8 px gap and two label lines', () => {
  assert.equal(HOME_CELL_HEIGHT, 106);
});

test('iPhone width: four columns with the phone gaps', () => {
  // 390 px screen − 2 × 24 px padding = 342 px of grid.
  const layout = homeGridLayout({ width: 342, height: 553 });
  assert.equal(layout.columns, 4);
  assert.equal(layout.columnGap, 16);
  // 5 rows take 5 × 106 = 530 px; the 23 px left are shared: 4 gaps of 5 px.
  assert.equal(layout.rows, 5);
  assert.equal(layout.rowGap, 5);
  assert.equal(layout.capacity, 20);
});

// Dima, 24.11: «спокойно влазит 4х5, внизу пустой ряд остаётся в некоторых темах».
// With the bottom bar his 430 × 932 PWA leaves the grid ≈ 573 pt at density 1
// and a little less in the roomier themes — a fixed 12 pt gap needed 578.
test('a few px short of five rows at a 12 pt gap still gives five rows', () => {
  for (const height of [573, 560, 546]) {
    const layout = homeGridLayout({ width: 382, height });
    assert.equal(layout.rows, 5, `height ${height}`);
    assert.equal(layout.capacity, 20);
    const used = 5 * 106 + 4 * layout.rowGap;
    assert.ok(used <= height, `the last row is not cut at ${height}`);
    assert.ok(height - used < 4, `no band left under the rows at ${height}`);
  }
});

test('spare height is shared between the rows, up to a 24 pt gap', () => {
  // 4 rows = 424; 545 leaves 121 → 40 per gap, capped at 24.
  const roomy = homeGridLayout({ width: 342, height: 545 });
  assert.equal(roomy.rows, 4);
  assert.equal(roomy.rowGap, 24);
  // Exactly five rows at the smallest gap.
  const tight = homeGridLayout({ width: 342, height: 5 * 106 + 4 * 4 });
  assert.equal(tight.rows, 5);
  assert.equal(tight.rowGap, 4);
});

test('rows are whole: one pixel short of a row drops it', () => {
  assert.equal(homeGridLayout({ width: 342, height: 4 * 106 + 3 * 4 }).rows, 4);
  assert.equal(homeGridLayout({ width: 342, height: 4 * 106 + 3 * 4 - 1 }).rows, 3);
});

// Dima's iPhone, 23.11 09:37 (reference/IMG_0103, 430 × 932 pt PWA): with the
// ☰ strip on top the first row starts at 317 pt and the app ends at 874 pt,
// so the grid area was 874 − 12 (bottom padding) − 317 = 545 pt — 4 rows and
// almost a row of empty space under them. The ☰ moves onto the clock line:
// its 40 pt strip and 12 pt of trimmed phone padding above the grid
// (pt-5 → pt-4, two mb-4 → mb-3) go to the grid.
const IPHONE_430_GRID = { width: 430 - 2 * 24, height: 545 + 40 + 12 };
// The same Home chrome on a 390 × 844 iPhone (safe area 47 top, 34 bottom):
// 16 + 48 clock + 26 date + 43 status bar + 12 + 36 search + 12 + 4 = 197 pt
// above the grid, 12 under it.
const IPHONE_390_GRID = { width: 390 - 2 * 24, height: 844 - 47 - 34 - 197 - 12 };

test('iPhone 430 × 932 PWA (IMG_0103): five rows, less than half a row left under them', () => {
  const layout = homeGridLayout(IPHONE_430_GRID);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 5);
  assert.equal(layout.capacity, 20);
  // The 68 px tile and its two label lines keep their size.
  assert.equal(layout.cellHeight, 106);
  const used = layout.rows * layout.cellHeight + (layout.rows - 1) * layout.rowGap;
  assert.ok(used <= IPHONE_430_GRID.height, 'the last row is not cut');
  assert.ok(IPHONE_430_GRID.height - used < (106 + layout.rowGap) / 2, 'less than half a row empty');
});

test('iPhone 390 × 844 PWA: five whole rows, none cut', () => {
  const layout = homeGridLayout(IPHONE_390_GRID);
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 5);
  assert.equal(layout.cellHeight, 106);
  assert.ok(5 * 106 + 4 * layout.rowGap <= IPHONE_390_GRID.height);
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
  // 390 px phone before the tap: 553 px of grid, 5 rows. The keyboard (~336 px)
  // leaves ~217 px — on its own that would be two rows.
  const before = { width: 342, height: 553 };
  const withKeyboard = { width: 342, height: 217 };
  assert.equal(homeGridLayout(withKeyboard).rows, 2);

  const held = holdGridSize(withKeyboard, before);
  assert.deepEqual(held, { width: 342, height: 553 });
  assert.equal(homeGridLayout(held).capacity, 20);
});

test('holding keeps the taller size and follows the width', () => {
  // Rotated to landscape while the keyboard is up: columns follow the width.
  assert.deepEqual(holdGridSize({ width: 700, height: 120 }, { width: 342, height: 553 }), { width: 700, height: 553 });
  // The area grew while held (keyboard closing) — the larger size wins.
  assert.deepEqual(holdGridSize({ width: 342, height: 600 }, { width: 342, height: 553 }), { width: 342, height: 600 });
  // Nothing held — the measurement as is.
  assert.deepEqual(holdGridSize({ width: 342, height: 217 }, null), { width: 342, height: 217 });
});

// Review of task 04: wiping the typed query to empty (or the «clear» cross)
// while the keyboard is still up turned the hold back on with the squeezed
// size — Home fell to one row until the keyboard closed.
function playHome(steps: { measured: { width: number; height: number }; focused: boolean; keyboard: boolean; query: string }[]) {
  let rest: { width: number; height: number } | null = null;
  return steps.map(({ measured, focused, keyboard, query }) => {
    const squeezed = focused || keyboard;
    const hold = query.trim() === '' && squeezed;
    const next = nextGridHold(rest, measured, { hold, squeezed });
    rest = next.rest;
    return homeGridLayout(next.size).rows;
  });
}

const OPEN = { width: 342, height: 553 }; // 5 rows, keyboard closed
const SQUEEZED = { width: 342, height: 217 }; // 2 rows under the keyboard

test('query typed and wiped while the keyboard is up → the rows from before the keyboard come back', () => {
  assert.deepEqual(
    playHome([
      { measured: OPEN, focused: false, keyboard: false, query: '' },
      { measured: OPEN, focused: true, keyboard: false, query: '' }, // tap the search
      { measured: SQUEEZED, focused: true, keyboard: true, query: '' }, // keyboard up
      { measured: SQUEEZED, focused: true, keyboard: true, query: 'ne' }, // typing: results scroll
      { measured: SQUEEZED, focused: true, keyboard: true, query: '' }, // wiped to empty
      { measured: OPEN, focused: false, keyboard: false, query: '' }, // keyboard gone
    ]),
    [5, 5, 5, 2, 5, 5],
  );
});

test('the «clear» cross (focus leaves the field, keyboard still up) also brings the rows back', () => {
  assert.deepEqual(
    playHome([
      { measured: OPEN, focused: false, keyboard: false, query: '' },
      { measured: OPEN, focused: true, keyboard: false, query: '' },
      { measured: SQUEEZED, focused: true, keyboard: true, query: 'neo' },
      { measured: SQUEEZED, focused: false, keyboard: true, query: '' }, // cross pressed
    ]),
    [5, 5, 2, 5],
  );
});

test('without the keyboard the grid follows every measurement', () => {
  assert.deepEqual(
    playHome([
      { measured: OPEN, focused: false, keyboard: false, query: '' },
      { measured: SQUEEZED, focused: false, keyboard: false, query: '' }, // window made shorter
      { measured: OPEN, focused: false, keyboard: false, query: '' },
    ]),
    [5, 2, 5],
  );
});
