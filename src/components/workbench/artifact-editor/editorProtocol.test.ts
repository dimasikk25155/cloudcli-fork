import assert from 'node:assert/strict';
import test from 'node:test';

import { createBridgeNonce, validateBridgeMessage } from './editorProtocol';

// Everything from the iframe is untrusted: a message is accepted only with our
// nonce, a known type, exactly the expected fields and the right value types.

const NONCE = 'n0nce-0123456789abcdef';
const rect = { x: 10, y: 20.5, w: 100, h: 40 };

test('valid messages of every type pass and come back as plain copies', () => {
  const valid = [
    { nonce: NONCE, type: 'ready', width: 1280, height: 4000, frames: ['3', '9'] },
    { nonce: NONCE, type: 'hover', id: '12', rect },
    { nonce: NONCE, type: 'hover', id: null, rect: null },
    { nonce: NONCE, type: 'pick', id: '4.1', shift: true },
    { nonce: NONCE, type: 'pick', id: null, shift: false },
    { nonce: NONCE, type: 'rects', items: [{ id: '4', rect, parentLayout: 'flex-row', editableText: true }] },
    { nonce: NONCE, type: 'siblings', id: '4', items: [{ id: '5', rect }] },
    { nonce: NONCE, type: 'textCommitted', id: '4', text: 'Новый заголовок' },
    { nonce: NONCE, type: 'textCancelled', id: '4' },
    { nonce: NONCE, type: 'snapshot', id: '4', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    { nonce: NONCE, type: 'snapshot', id: '4', dataUrl: null },
    { nonce: NONCE, type: 'scroll', x: 0, y: 340 },
  ];
  for (const message of valid) {
    const result = validateBridgeMessage(message, NONCE);
    assert.deepEqual(result, message, message.type);
    assert.notEqual(result, message, 'a copy, not the object from the iframe');
  }
});

test('a foreign or missing nonce is refused', () => {
  const message = { type: 'pick', id: '4', shift: false };
  assert.equal(validateBridgeMessage({ ...message, nonce: 'other-nonce-0123456789' }, NONCE), null);
  assert.equal(validateBridgeMessage(message, NONCE), null);
  assert.equal(validateBridgeMessage({ ...message, nonce: '' }, ''), null, 'an empty expected nonce accepts nothing');
});

test('extra fields, unknown types and wrong value types are refused', () => {
  const refused: unknown[] = [
    null, 'ready', 42, [], { nonce: NONCE },
    { nonce: NONCE, type: 'apply', op: { type: 'remove', id: '1' } },
    { nonce: NONCE, type: 'pick', id: '4', shift: false, extra: 1 },
    { nonce: NONCE, type: 'pick', id: 4, shift: false },
    { nonce: NONCE, type: 'pick', id: '4' },
    { nonce: NONCE, type: 'pick', id: '<img onerror>', shift: false },
    { nonce: NONCE, type: 'hover', id: '1', rect: { x: 1, y: 2, w: 3 } },
    { nonce: NONCE, type: 'hover', id: '1', rect: { x: 1, y: 2, w: -3, h: 4 } },
    { nonce: NONCE, type: 'hover', id: '1', rect: { x: Number.NaN, y: 2, w: 3, h: 4 } },
    { nonce: NONCE, type: 'hover', id: '1', rect: { x: 1, y: 2, w: 3, h: 4, z: 0 } },
    { nonce: NONCE, type: 'rects', items: [{ id: '4', rect, parentLayout: 'table', editableText: true }] },
    { nonce: NONCE, type: 'rects', items: [{ id: '4', rect, parentLayout: 'block', editableText: 'yes' }] },
    { nonce: NONCE, type: 'rects', items: 'all' },
    { nonce: NONCE, type: 'ready', width: '1280', height: 10, frames: [] },
    { nonce: NONCE, type: 'ready', width: 1280, height: 10, frames: [1] },
    { nonce: NONCE, type: 'textCommitted', id: '4', text: 5 },
    { nonce: NONCE, type: 'snapshot', id: '4', dataUrl: 'javascript:alert(1)' },
    { nonce: NONCE, type: 'snapshot', id: '4', dataUrl: 'data:text/html;base64,PHA+' },
    { nonce: NONCE, type: 'scroll', x: Infinity, y: 0 },
  ];
  for (const message of refused) assert.equal(validateBridgeMessage(message, NONCE), null, JSON.stringify(message));
});

test('limits: oversized lists and texts are refused', () => {
  const items = Array.from({ length: 5001 }, (_, index) => ({ id: String(index), rect }));
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'siblings', id: '1', items }, NONCE), null);
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'textCommitted', id: '1', text: 'x'.repeat(100001) }, NONCE), null);
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'pick', id: 'x'.repeat(201), shift: false }, NONCE), null);
});

test('createBridgeNonce: a fresh random hex key every time', () => {
  const a = createBridgeNonce();
  const b = createBridgeNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('zoomWheel (Cmd/Ctrl+wheel inside the page) carries only a finite deltaY', () => {
  assert.deepEqual(validateBridgeMessage({ nonce: NONCE, type: 'zoomWheel', deltaY: -120 }, NONCE), { nonce: NONCE, type: 'zoomWheel', deltaY: -120 });
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'zoomWheel', deltaY: '1' }, NONCE), null);
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'zoomWheel', deltaY: Number.NaN }, NONCE), null);
  assert.equal(validateBridgeMessage({ nonce: NONCE, type: 'zoomWheel', deltaY: 1, x: 2 }, NONCE), null);
});
