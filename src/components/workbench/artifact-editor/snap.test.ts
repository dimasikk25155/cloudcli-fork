import assert from 'node:assert/strict';
import test from 'node:test';

import { snapRect } from './snap';

// Snapping a moved box: edges and centres of neighbours within the threshold
// win (with a guide line), otherwise the 8 px grid; Alt or the button turn it off.

const opts = { grid: 8, threshold: 5, enabled: true };

test('turned off: the box stays where the mouse put it, no guides', () => {
  const moving = { x: 13, y: 21, w: 50, h: 30 };
  assert.deepEqual(snapRect(moving, [{ x: 10, y: 20, w: 50, h: 30 }], { ...opts, enabled: false }), { rect: moving, guides: [] });
});

test('no neighbour nearby: the top-left corner goes to the nearest grid line', () => {
  assert.deepEqual(snapRect({ x: 13, y: 21, w: 50, h: 30 }, [], opts), { rect: { x: 16, y: 24, w: 50, h: 30 }, guides: [] });
  assert.deepEqual(snapRect({ x: 11, y: 3, w: 50, h: 30 }, [], { ...opts, grid: 0 }), { rect: { x: 11, y: 3, w: 50, h: 30 }, guides: [] }, 'grid 0 — no grid');
});

test('a neighbour edge within the threshold wins over the grid and draws a guide', () => {
  const result = snapRect({ x: 103, y: 0, w: 30, h: 30 }, [{ x: 101, y: 200, w: 40, h: 40 }], opts);
  assert.deepEqual(result.rect, { x: 101, y: 0, w: 30, h: 30 });
  assert.deepEqual(result.guides, [{ axis: 'x', pos: 101 }]);
});

test('centres line up: the closest pair of lines is chosen on each axis', () => {
  // Centre 119 vs the neighbour's centre 120 (left edges differ by 9, right edges by 11).
  const result = snapRect({ x: 109, y: 57, w: 20, h: 10 }, [{ x: 100, y: 40, w: 40, h: 40 }], opts);
  assert.deepEqual(result.rect, { x: 110, y: 55, w: 20, h: 10 });
  assert.deepEqual(result.guides, [{ axis: 'x', pos: 120 }, { axis: 'y', pos: 60 }]);
});

test('right edge to left edge: boxes placed side by side', () => {
  const result = snapRect({ x: 47, y: 64, w: 50, h: 20 }, [{ x: 100, y: 300, w: 10, h: 10 }], opts);
  assert.deepEqual(result.rect, { x: 50, y: 64, w: 50, h: 20 });
  assert.deepEqual(result.guides, [{ axis: 'x', pos: 100 }]);
});
