import assert from 'node:assert/strict';
import test from 'node:test';

import { docRectToScreen, screenPointToDoc } from './editorUiModel';
import { frameDropOrder } from './frames';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, fitZoom, stepZoom, wheelZoom, zoomLabel } from './zoomModel';

// Масштаб холста 25–400 %: кнопки −/+, «Вписать», Cmd/Ctrl+колесо;
// рамки выделения точны на любом масштабе; порядок слайдов перетаскиванием.

test('zoom stays within 25–400 %', () => {
  assert.equal(ZOOM_MIN, 0.25);
  assert.equal(ZOOM_MAX, 4);
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(9), 4);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(1.5), 1.5);
});

test('−/+ go along fixed steps and stop at the ends', () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(1.1, 1), 1.25); // off-step value → the next step up
  assert.equal(stepZoom(1.1, -1), 1);
  assert.equal(stepZoom(4, 1), 4);
  assert.equal(stepZoom(0.25, -1), 0.25);
  assert.equal(stepZoom(0.3, -1), 0.25);
});

test('Cmd/Ctrl+wheel: up zooms in, down zooms out, clamped', () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(4, -1000), 4);
  assert.equal(wheelZoom(0.25, 1000), 0.25);
  assert.equal(wheelZoom(1, 0), 1);
});

test('fit: a wide fixed page shrinks to the stage width; a responsive page goes to 100 %', () => {
  // 1600 px page in a 800 px viewport → fit width 800/1600.
  assert.equal(fitZoom({ kind: 'html', contentWidth: 1600, contentHeight: 3000, viewportWidth: 800, stageWidth: 800, stageHeight: 600 }), 0.5);
  // The page fills its viewport (it reflows) → 100 %.
  assert.equal(fitZoom({ kind: 'html', contentWidth: 1600, contentHeight: 5000, viewportWidth: 1600, stageWidth: 800, stageHeight: 600 }), 1);
  // SVG fits whole: the tighter side wins.
  assert.equal(fitZoom({ kind: 'svg', contentWidth: 400, contentHeight: 1200, viewportWidth: 800, stageWidth: 800, stageHeight: 600 }), 0.5);
  // Never past the limits.
  assert.equal(fitZoom({ kind: 'svg', contentWidth: 10, contentHeight: 10, viewportWidth: 800, stageWidth: 800, stageHeight: 600 }), 4);
  assert.equal(fitZoom({ kind: 'html', contentWidth: 0, contentHeight: 0, viewportWidth: 800, stageWidth: 800, stageHeight: 600 }), 1);
});

test('label shows whole percent', () => {
  assert.equal(zoomLabel(1), '100 %');
  assert.equal(zoomLabel(0.333), '33 %');
  assert.equal(zoomLabel(4), '400 %');
});

test('selection frame is exact at 25 % and 400 %: doc → screen → doc round trip', () => {
  const rect = { x: 120, y: 340, w: 64, h: 18 };
  for (const zoom of [0.25, 0.5, 1.75, 4]) {
    const view = { zoom, scrollX: 30, scrollY: 200 };
    const screen = docRectToScreen(rect, view);
    assert.deepEqual(screen, { x: (120 - 30) * zoom, y: (340 - 200) * zoom, w: 64 * zoom, h: 18 * zoom });
    const corner = screenPointToDoc({ x: screen.x + screen.w, y: screen.y + screen.h }, view);
    assert.ok(Math.abs(corner.x - 184) < 1e-9 && Math.abs(corner.y - 358) < 1e-9, `zoom ${zoom}`);
  }
});

test('dropping a slide thumbnail before another gives the new frame order', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(frameDropOrder(order, 0, 2), ['b', 'a', 'c', 'd']); // a before c
  assert.deepEqual(frameDropOrder(order, 3, 0), ['d', 'a', 'b', 'c']); // d to the front
  assert.deepEqual(frameDropOrder(order, 1, 4), ['a', 'c', 'd', 'b']); // b to the end
  assert.equal(frameDropOrder(order, 1, 1), null); // before itself
  assert.equal(frameDropOrder(order, 1, 2), null); // before its own next
  assert.equal(frameDropOrder(order, 9, 0), null);
});
