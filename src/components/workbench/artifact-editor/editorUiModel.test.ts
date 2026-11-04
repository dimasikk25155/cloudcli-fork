import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArtifactDetail } from '../../../../shared/artifacts';

import type { EditorOp, StackEntry } from './editorModel';
import {
  canEditArtifact,
  createEditorHistory,
  docRectToScreen,
  editorDocKind,
  fontFamiliesIn,
  isReorderNoop,
  pickSelection,
  pruneSelection,
  reorderTarget,
  resizeFromHandle,
  screenDeltaToDoc,
  svgUnitsPerPx,
  toHexColor,
  pxNumber,
  readInlineStyle,
  unionRect,
} from './editorUiModel';

const idOf = (op: EditorOp) => ('id' in op ? op.id : op.ids.join(','));

const entry = (id: string, value = 'red'): StackEntry => ({
  op: { type: 'style', id, prop: 'color', value },
  inverse: { type: 'attrs', id, attrs: { style: null } },
  fp: null,
});

test('a plain click selects one element, Shift adds or removes it', () => {
  assert.deepEqual(pickSelection([], '4', false), ['4']);
  assert.deepEqual(pickSelection(['4', '7'], '9', false), ['9']);
  assert.deepEqual(pickSelection(['4'], '7', true), ['4', '7'], 'Shift adds, the last one is the primary');
  assert.deepEqual(pickSelection(['4', '7'], '4', true), ['7'], 'Shift on a selected one removes it');
  assert.deepEqual(pickSelection(['4', '7'], '7', false), ['7']);
});

test('ids gone from the document (undo of a duplicate, a removal) leave the selection', () => {
  const alive = new Set(['1', '3']);
  assert.deepEqual(pruneSelection(['1', '2', '3'], (id) => alive.has(id)), ['1', '3']);
});

test('history: one user action = one group; undo/redo by groups; a new action drops redo', () => {
  const history = createEditorHistory();
  assert.equal(history.canUndo, false);
  history.push([entry('1'), entry('2')]);
  history.push([entry('3')]);
  assert.deepEqual(history.undo()?.map((e) => idOf(e.op)), ['3']);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo()?.map((e) => idOf(e.op)), ['3']);
  assert.deepEqual(history.undo()?.map((e) => idOf(e.op)), ['3']);
  history.push([entry('4')]);
  assert.equal(history.canRedo, false, 'a new action after undo drops the undone ones');
  assert.deepEqual(history.groups().map((g) => g.map((e) => idOf(e.op))), [['1', '2'], ['4']]);
  assert.deepEqual(history.ops().map(idOf), ['1', '2', '4']);
});

test('history keeps at most 200 actions (spec: стек до 200 операций)', () => {
  const history = createEditorHistory();
  for (let i = 1; i <= 205; i += 1) history.push([entry(String(i))]);
  const groups = history.groups();
  assert.equal(groups.length, 200);
  assert.equal(idOf(groups[0][0].op), '6', 'the oldest five dropped');
});

test('dirty: clean after save; undo past the save makes it dirty again (until the next save)', () => {
  const history = createEditorHistory();
  assert.equal(history.dirty, false);
  history.push([entry('1')]);
  assert.equal(history.dirty, true);
  history.markSaved();
  assert.equal(history.dirty, false);
  history.undo();
  assert.equal(history.dirty, true, 'undo after save changes the document again');
  history.redo();
  assert.equal(history.dirty, false, 'redo back to the saved point');
});

test('the last single-entry action can be amended (a colour picker drag is one action)', () => {
  const history = createEditorHistory();
  history.push([entry('1', 'red')]);
  history.markSaved();
  assert.equal(history.amendLast({ type: 'style', id: '1', prop: 'color', value: 'blue' }), true);
  assert.equal(history.groups().length, 1);
  assert.deepEqual(history.groups()[0][0].op, { type: 'style', id: '1', prop: 'color', value: 'blue' });
  assert.deepEqual(history.groups()[0][0].inverse, { type: 'attrs', id: '1', attrs: { style: null } }, 'the first inverse stays');
  assert.equal(history.dirty, true, 'an amended action is a change');
  history.push([entry('2'), entry('3')]);
  assert.equal(history.amendLast({ type: 'style', id: '3', prop: 'color', value: 'x' }), false, 'a group of several is not amended');
});

test('replace() installs replayed groups as the new clean-or-dirty history', () => {
  const history = createEditorHistory();
  history.push([entry('1')]);
  history.undo();
  history.replace([[entry('8')], [entry('9')]]);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.ops().map(idOf), ['8', '9']);
  assert.equal(history.dirty, true);
});

test('document rect → screen: minus the iframe scroll, times zoom', () => {
  const rect = { x: 100, y: 300, w: 50, h: 20 };
  assert.deepEqual(docRectToScreen(rect, { zoom: 1, scrollX: 0, scrollY: 200 }), { x: 100, y: 100, w: 50, h: 20 });
  assert.deepEqual(docRectToScreen(rect, { zoom: 2, scrollX: 10, scrollY: 200 }), { x: 180, y: 200, w: 100, h: 40 });
  assert.deepEqual(docRectToScreen(rect, { zoom: 0.5, scrollX: 0, scrollY: 0 }), { x: 50, y: 150, w: 25, h: 10 });
});

test('a mouse drag on screen → document pixels: divided by zoom', () => {
  assert.deepEqual(screenDeltaToDoc(40, -20, 2), { dx: 20, dy: -10 });
  assert.deepEqual(screenDeltaToDoc(40, -20, 0.25), { dx: 160, dy: -80 });
  assert.deepEqual(screenDeltaToDoc(5, 5, 1), { dx: 5, dy: 5 });
});

test('union of several selected boxes', () => {
  assert.deepEqual(unionRect([{ x: 10, y: 10, w: 10, h: 10 }, { x: 30, y: 0, w: 5, h: 50 }]), { x: 10, y: 0, w: 25, h: 50 });
  assert.equal(unionRect([]), null);
});

test('reorder in a flex row: insert before the first neighbour whose centre is right of the pointer', () => {
  const siblings = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'b', rect: { x: 110, y: 0, w: 100, h: 40 } },
    { id: 'c', rect: { x: 220, y: 0, w: 100, h: 40 } },
  ];
  assert.equal(reorderTarget({ x: 20, y: 10 }, siblings, 'flex-row').beforeId, 'a');
  assert.equal(reorderTarget({ x: 170, y: 10 }, siblings, 'flex-row').beforeId, 'c');
  const end = reorderTarget({ x: 300, y: 10 }, siblings, 'flex-row');
  assert.equal(end.beforeId, null, 'past the last centre — to the end');
  assert.deepEqual(end.line, { x: 320, y: 0, w: 0, h: 40 }, 'the marker after the last one');
  assert.deepEqual(reorderTarget({ x: 20, y: 10 }, siblings, 'flex-row').line, { x: 0, y: 0, w: 0, h: 40 });
});

test('reorder in a column uses the vertical centre; in a grid — rows first', () => {
  const column = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'b', rect: { x: 0, y: 50, w: 100, h: 40 } },
  ];
  assert.equal(reorderTarget({ x: 500, y: 60 }, column, 'flex-col').beforeId, 'b');
  assert.deepEqual(reorderTarget({ x: 500, y: 60 }, column, 'flex-col').line, { x: 0, y: 50, w: 100, h: 0 });
  const grid = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', rect: { x: 110, y: 0, w: 100, h: 100 } },
    { id: 'c', rect: { x: 0, y: 110, w: 100, h: 100 } },
    { id: 'd', rect: { x: 110, y: 110, w: 100, h: 100 } },
  ];
  assert.equal(reorderTarget({ x: 150, y: 150 }, grid, 'grid').beforeId, 'd', 'second row, left of d centre');
  assert.equal(reorderTarget({ x: 5, y: 150 }, grid, 'grid').beforeId, 'c');
  assert.equal(reorderTarget({ x: 300, y: 50 }, grid, 'grid').beforeId, 'c', 'right of the first row → start of the next row');
});

test('a reorder that keeps the element where it is is not an operation', () => {
  assert.equal(isReorderNoop({ beforeId: 'b', nextId: 'b' }), true);
  assert.equal(isReorderNoop({ beforeId: null, nextId: null }), true);
  assert.equal(isReorderNoop({ beforeId: 'a', nextId: 'c' }), false);
  assert.equal(isReorderNoop({ beforeId: null, nextId: 'c' }), false);
});

test('resize by handles: east — width, south — height, corner — both; minimum 4 px; grid with snap', () => {
  const start = { x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(resizeFromHandle(start, 'e', 13, 99, { grid: 8, snap: false }), { w: 113, h: 50 });
  assert.deepEqual(resizeFromHandle(start, 's', 13, 7, { grid: 8, snap: false }), { w: 100, h: 57 });
  assert.deepEqual(resizeFromHandle(start, 'se', 13, 7, { grid: 8, snap: true }), { w: 112, h: 56 });
  assert.deepEqual(resizeFromHandle(start, 'se', -500, -500, { grid: 8, snap: false }), { w: 4, h: 4 });
});

test('SVG user units per CSS pixel: viewBox width over the drawn width', () => {
  assert.equal(svgUnitsPerPx({ viewBox: '0 0 200 100', width: '400', renderedWidth: 999 }), 0.5);
  assert.equal(svgUnitsPerPx({ viewBox: '0 0 200 100', width: '100%', renderedWidth: 800 }), 0.25);
  assert.equal(svgUnitsPerPx({ viewBox: '0,0,1000,500', width: null, renderedWidth: 500 }), 2);
  assert.equal(svgUnitsPerPx({ viewBox: null, width: '400', renderedWidth: 800 }), 1, 'no viewBox — one unit is one pixel');
  assert.equal(svgUnitsPerPx({ viewBox: 'junk', width: null, renderedWidth: null }), 1);
});

test('font families used on the page, without duplicates', () => {
  const css = ['body { font-family: "Inter", sans-serif; }', 'color: red; font-family: Georgia, serif', 'h1{font-family:"Inter", sans-serif}'];
  assert.deepEqual(fontFamiliesIn(css), ['"Inter", sans-serif', 'Georgia, serif']);
});

test('colour for the colour picker: hex and rgb() become #rrggbb, the rest — none', () => {
  assert.equal(toHexColor('#ABC'), '#aabbcc');
  assert.equal(toHexColor('#1a2B3c'), '#1a2b3c');
  assert.equal(toHexColor('rgb(255, 0, 16)'), '#ff0010');
  assert.equal(toHexColor('rgba(0,0,0,0.5)'), '#000000');
  assert.equal(toHexColor('var(--brand)'), null);
  assert.equal(toHexColor(null), null);
});

test('pixel values of the panel', () => {
  assert.equal(pxNumber('12px'), 12);
  assert.equal(pxNumber(' 1.5px '), 1.5);
  assert.equal(pxNumber('0'), 0);
  assert.equal(pxNumber('2em'), null);
  assert.equal(pxNumber(null), null);
});

const detail = (path: string, kind: string, opts: { exists?: boolean } = {}): ArtifactDetail => ({
  artifact: { id: 'a1', path, kind, latestVersion: 2 } as unknown as ArtifactDetail['artifact'],
  versions: [],
  comments: [],
  file: { exists: opts.exists ?? true, absPath: `/p/${path}` },
});

test('«Правка» is offered for HTML, slides and SVG with a file on disk; not for raster pictures', () => {
  assert.equal(canEditArtifact(detail('page.html', 'html')), true);
  assert.equal(canEditArtifact(detail('deck-slides.html', 'slides')), true);
  assert.equal(canEditArtifact(detail('logo.svg', 'image')), true);
  assert.equal(canEditArtifact(detail('photo.png', 'image')), false);
  assert.equal(canEditArtifact(detail('notes.md', 'markdown')), false);
  assert.equal(canEditArtifact(detail('page.html', 'html', { exists: false })), false);
  assert.equal(editorDocKind('logo.SVG'), 'svg');
  assert.equal(editorDocKind('page.htm'), 'html');
});

test('panel reads a declaration of the style attribute (the last one wins; quotes and url() kept whole)', () => {
  const style = 'color: red; background: url("a;b.png"); font-family: "A; B", serif; color: #00f';
  assert.equal(readInlineStyle(style, 'color'), '#00f');
  assert.equal(readInlineStyle(style, 'font-family'), '"A; B", serif');
  assert.equal(readInlineStyle(style, 'background'), 'url("a;b.png")');
  assert.equal(readInlineStyle(style, 'margin-top'), null);
  assert.equal(readInlineStyle(null, 'color'), null);
});
