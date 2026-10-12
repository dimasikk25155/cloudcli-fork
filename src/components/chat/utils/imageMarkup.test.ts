import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_IMAGE_EDGE } from './imageDownscale.js';
import { commitShape, markedFileIdentity, markupCanvasSize, undoShape, type MarkupShape } from './imageMarkup.js';

const red = '#ef4444';
const circle: MarkupShape = { kind: 'ellipse', color: red, width: 6, from: { x: 10, y: 10 }, to: { x: 120, y: 80 } };
const arrow: MarkupShape = { kind: 'arrow', color: red, width: 6, from: { x: 200, y: 200 }, to: { x: 40, y: 40 } };
const scribble: MarkupShape = { kind: 'pen', color: red, width: 6, points: [{ x: 1, y: 1 }, { x: 5, y: 9 }, { x: 12, y: 3 }] };

test('each finished mark is added in order', () => {
  const history = commitShape(commitShape(commitShape([], circle), arrow), scribble);
  assert.deepEqual(history, [circle, arrow, scribble]);
});

test('undo takes back only the last mark, one step at a time', () => {
  const history = [circle, arrow, scribble];
  const once = undoShape(history);
  assert.deepEqual(once, [circle, arrow]);
  assert.deepEqual(undoShape(once), [circle]);
  assert.deepEqual(history, [circle, arrow, scribble], 'earlier history stays intact');
});

test('undo on a clean picture does nothing', () => {
  assert.deepEqual(undoShape([]), []);
});

test('an accidental tap with the oval or arrow leaves no mark', () => {
  const tapOval: MarkupShape = { kind: 'ellipse', color: red, width: 6, from: { x: 50, y: 50 }, to: { x: 51, y: 50 } };
  const tapArrow: MarkupShape = { kind: 'arrow', color: red, width: 6, from: { x: 50, y: 50 }, to: { x: 50, y: 52 } };
  assert.deepEqual(commitShape(commitShape([circle], tapOval), tapArrow), [circle]);
});

test('a pencil tap is a dot and stays; an empty pencil stroke does not', () => {
  const dot: MarkupShape = { kind: 'pen', color: red, width: 6, points: [{ x: 3, y: 3 }] };
  const nothing: MarkupShape = { kind: 'pen', color: red, width: 6, points: [] };
  assert.deepEqual(commitShape(commitShape([], dot), nothing), [dot]);
});

test('blank text is not a mark, real text is', () => {
  const blank: MarkupShape = { kind: 'text', color: red, size: 40, at: { x: 5, y: 5 }, text: '   ' };
  const label: MarkupShape = { kind: 'text', color: red, size: 40, at: { x: 5, y: 5 }, text: 'тут ошибка' };
  assert.deepEqual(commitShape(commitShape([], blank), label), [label]);
});

test('the saved picture keeps its name and type when the browser can encode it', () => {
  assert.deepEqual(markedFileIdentity('shot.jpg', 'image/jpeg', 'image/jpeg'), { name: 'shot.jpg', type: 'image/jpeg' });
  assert.deepEqual(markedFileIdentity('Screenshot 1.png', 'image/png', 'image/png'), { name: 'Screenshot 1.png', type: 'image/png' });
});

test('when the browser had to fall back to PNG the name says png too', () => {
  assert.deepEqual(markedFileIdentity('anim.gif', 'image/gif', 'image/png'), { name: 'anim.png', type: 'image/png' });
  assert.deepEqual(markedFileIdentity('photo', '', 'image/png'), { name: 'photo.png', type: 'image/png' });
});

test('a camera-sized picture is edited at the upload size limit, keeping its proportions', () => {
  const size = markupCanvasSize(3000, 4000);
  assert.equal(size.height, MAX_IMAGE_EDGE);
  assert.equal(size.width, Math.round(3000 * (MAX_IMAGE_EDGE / 4000)));
  assert.deepEqual(markupCanvasSize(4000, 1000), { width: MAX_IMAGE_EDGE, height: Math.round(1000 * (MAX_IMAGE_EDGE / 4000)) });
});

test('a picture within the limit is edited at its own size', () => {
  assert.deepEqual(markupCanvasSize(1170, 1500), { width: 1170, height: 1500 });
});
