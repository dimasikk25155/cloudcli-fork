import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOpToDocument, createOpStack, type EditorOp, type StackEntry } from './editorModel';

// Pure parts of the edit model in node. DOM functions (instrument, serialize,
// inverse, replay) are checked in the browser by selftest.ts (?neo3EditorSelfTest=1).

const entry = (n: number): StackEntry => ({
  op: { type: 'translate', id: String(n), dx: n, dy: 0 },
  inverse: { type: 'attrs', id: String(n), attrs: { style: null } },
  fp: null,
});

test('op stack: undo returns the last entry, redo brings it back, a new push drops the redo part', () => {
  const stack = createOpStack();
  assert.equal(stack.canUndo, false);
  assert.equal(stack.undo(), null);
  stack.push(entry(1));
  stack.push(entry(2));
  stack.push(entry(3));
  assert.deepEqual(stack.entries().map((e) => e.op), [entry(1).op, entry(2).op, entry(3).op]);
  assert.deepEqual(stack.undo()?.op, entry(3).op);
  assert.deepEqual(stack.undo()?.op, entry(2).op);
  assert.equal(stack.canRedo, true);
  assert.deepEqual(stack.redo()?.op, entry(2).op);
  assert.deepEqual(stack.entries().map((e) => e.op), [entry(1).op, entry(2).op]);
  stack.push(entry(4));
  assert.equal(stack.canRedo, false, 'a new operation forgets what was undone');
  assert.equal(stack.redo(), null);
  assert.deepEqual(stack.entries().map((e) => e.op), [entry(1).op, entry(2).op, entry(4).op]);
  stack.clear();
  assert.equal(stack.canUndo, false);
  assert.deepEqual(stack.entries(), []);
});

test('op stack keeps the last 200 operations by default', () => {
  const stack = createOpStack();
  for (let n = 1; n <= 205; n += 1) stack.push(entry(n));
  const kept = stack.entries();
  assert.equal(kept.length, 200);
  assert.deepEqual(kept[0].op, entry(6).op);
  assert.deepEqual(kept[199].op, entry(205).op);
  let undone = 0;
  while (stack.undo()) undone += 1;
  assert.equal(undone, 200);
  const small = createOpStack(2);
  small.push(entry(1));
  small.push(entry(2));
  small.push(entry(3));
  assert.deepEqual(small.entries().map((e) => e.op), [entry(2).op, entry(3).op]);
});

// A minimal stand-in for one element of a page: enough for the style-attribute code paths.
function fakeDocument(attrs: Record<string, string>, options: { svg?: boolean } = {}) {
  const ns = options.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml';
  const values = new Map(Object.entries(attrs));
  let text = 'старый';
  const element = {
    namespaceURI: ns,
    localName: options.svg ? 'rect' : 'p',
    parentElement: { namespaceURI: ns },
    childNodes: [{ nodeType: 3 }],
    getAttribute: (name: string) => values.get(name) ?? null,
    setAttribute: (name: string, value: string) => { values.set(name, value); },
    removeAttribute: (name: string) => { values.delete(name); },
    hasAttribute: (name: string) => values.has(name),
    get textContent() { return text; },
    set textContent(value: string) { text = value; },
  };
  const doc = {
    documentElement: {},
    body: {},
    head: {},
    querySelectorAll: () => [element],
  };
  return { doc: doc as unknown as Document, values, text: () => text };
}

test('applyOpToDocument is self-contained: a function rebuilt from its source (as the bridge does) applies operations', () => {
  const source = applyOpToDocument.toString();
  assert.doesNotMatch(source, /\bimport\b|\brequire\(/);
  // The bridge defines `__name` (a no-op) for builds that wrap nested functions with it.
  const rebuilt = new Function('__name', `return (${source});`)((fn: unknown) => fn) as typeof applyOpToDocument;
  assert.equal(typeof rebuilt, 'function');

  const page = fakeDocument({ 'data-neo3-id': '7', style: 'color:red;margin:0' });
  const apply = (op: EditorOp) => rebuilt(page.doc, op);
  assert.equal(apply({ type: 'style', id: '7', prop: 'color', value: 'blue' }), true);
  assert.equal(page.values.get('style'), 'color: blue;margin:0', 'only the edited declaration changes');
  assert.equal(apply({ type: 'style', id: '7', prop: 'font-size', value: '20px' }), true);
  assert.equal(page.values.get('style'), 'color: blue;margin:0; font-size: 20px;');
  assert.equal(apply({ type: 'translate', id: '7', dx: 5, dy: -2.5 }), true);
  assert.equal(apply({ type: 'translate', id: '7', dx: 1, dy: 0 }), true);
  assert.match(page.values.get('style')!, /translate: 6px -2\.5px;$/, 'shifts accumulate in the CSS translate property');
  assert.equal(apply({ type: 'translate', id: '7', dx: -6, dy: 2.5 }), true);
  assert.doesNotMatch(page.values.get('style')!, /translate/, 'back to zero — the property is gone');
  assert.equal(apply({ type: 'hide', id: '7', hidden: true }), true);
  assert.match(page.values.get('style')!, /display: none;$/);
  assert.equal(apply({ type: 'hide', id: '7', hidden: false }), true);
  assert.doesNotMatch(page.values.get('style')!, /display/);
  assert.equal(apply({ type: 'style', id: '7', prop: 'color', value: null }), true);
  assert.equal(apply({ type: 'style', id: '7', prop: 'font-size', value: null }), true);
  assert.equal(page.values.get('style'), 'margin:0;');
  assert.equal(apply({ type: 'resize', id: '7', width: 2, height: 30.456 }), true);
  assert.equal(page.values.get('style'), 'margin:0; width: 4px; height: 30.46px; box-sizing: border-box;', 'minimum side is 4 px');
  assert.equal(apply({ type: 'text', id: '7', text: 'новый' }), true);
  assert.equal(page.text(), 'новый');
  assert.equal(apply({ type: 'attrs', id: '7', attrs: { style: 'color:red;margin:0' } }), true);
  assert.equal(page.values.get('style'), 'color:red;margin:0');

  // Refusals: unknown element, unknown property, a value that would inject declarations, a foreign attribute.
  const empty = { ...(page.doc as unknown as Record<string, unknown>), querySelectorAll: () => [] } as unknown as Document;
  assert.equal(rebuilt(empty, { type: 'style', id: 'nope', prop: 'color', value: 'red' }), false);
  assert.equal(apply({ type: 'style', id: '7', prop: 'position' as never, value: 'fixed' }), false);
  assert.equal(apply({ type: 'style', id: '7', prop: 'color', value: 'red; position: fixed' }), false);
  assert.equal(apply({ type: 'attrs', id: '7', attrs: { onclick: 'x' } as never }), false);
  assert.equal(apply({ type: 'translate', id: '7', dx: Number.NaN, dy: 0 }), false);
  assert.equal(rebuilt(page.doc, null as never), false);
  assert.equal(rebuilt(page.doc, { type: 'explode' } as never), false);
  assert.equal(page.values.get('style'), 'color:red;margin:0', 'refused operations change nothing');

  // SVG shapes move through their transform attribute, in front of the existing transform.
  const svg = fakeDocument({ 'data-neo3-id': '3', transform: 'rotate(5)' }, { svg: true });
  assert.equal(rebuilt(svg.doc, { type: 'translate', id: '3', dx: 10, dy: 4 }), true);
  assert.equal(svg.values.get('transform'), 'translate(10 4) rotate(5)');
  assert.equal(rebuilt(svg.doc, { type: 'translate', id: '3', dx: -10, dy: -4 }), true);
  assert.equal(svg.values.get('transform'), 'rotate(5)');
  assert.equal(rebuilt(svg.doc, { type: 'resize', id: '3', width: 40, height: 20 }), true);
  assert.deepEqual([svg.values.get('width'), svg.values.get('height')], ['40', '20']);
});
