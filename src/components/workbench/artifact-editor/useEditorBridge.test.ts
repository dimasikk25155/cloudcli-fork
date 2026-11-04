import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptBridgeMessage } from './useEditorBridge';

// The parent trusts a message only from its own iframe window, with this
// session's nonce, and only in the shape validateBridgeMessage lets through.

const NONCE = 'abcdef0123456789abcdef';
const frameWindow = { name: 'our iframe' };
const pick = { nonce: NONCE, type: 'pick', id: '4', shift: false };

test('a valid message from our iframe passes as a copy', () => {
  const result = acceptBridgeMessage({ source: frameWindow, data: pick }, frameWindow, NONCE);
  assert.deepEqual(result, pick);
  assert.notEqual(result, pick);
});

test('another window, no iframe yet, a foreign nonce or a bad shape — refused', () => {
  assert.equal(acceptBridgeMessage({ source: { name: 'other' }, data: pick }, frameWindow, NONCE), null, 'another window');
  assert.equal(acceptBridgeMessage({ source: null, data: pick }, null, NONCE), null, 'no iframe window');
  assert.equal(acceptBridgeMessage({ source: frameWindow, data: { ...pick, nonce: 'zzzzzzzzzzzzzzzzzzzz' } }, frameWindow, NONCE), null, 'foreign nonce');
  assert.equal(acceptBridgeMessage({ source: frameWindow, data: { ...pick, extra: 1 } }, frameWindow, NONCE), null, 'extra field');
  assert.equal(acceptBridgeMessage({ source: frameWindow, data: pick }, frameWindow, ''), null, 'no nonce yet');
});
