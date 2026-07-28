import assert from 'node:assert/strict';
import test from 'node:test';

import { computeKeyboardInsets } from './keyboard-insets.js';

test('no keyboard means no insets at all', () => {
  assert.deepEqual(computeKeyboardInsets(844, 844, 0), { offset: 0, height: 0 });
});

test('the address bar collapsing is not mistaken for a keyboard', () => {
  // iOS shrinks the visual viewport by ~60-90px while you scroll. Treating
  // that as a keyboard made the shell bounce during ordinary reading.
  assert.deepEqual(computeKeyboardInsets(844, 754, 0), { offset: 0, height: 0 });
});

test('Android only loses the bottom, since its layout viewport shrinks too', () => {
  assert.deepEqual(computeKeyboardInsets(844, 508, 0), { offset: 0, height: 336 });
});

test('iOS keyboard: the shell follows the downward shift instead of losing its top', () => {
  // The reported bug: iPhone, keyboard up in the composer. WebKit kept the
  // page 844 tall, left 508 visible and scrolled that window 180px down. The
  // old code trimmed 336px off the bottom and ignored the shift, so the top
  // slid off-screen and a 180px dead strip sat above the keyboard.
  const insets = computeKeyboardInsets(844, 508, 180);

  assert.deepEqual(insets, { offset: 180, height: 156 });
  // Top + bottom insets must add up to everything the keyboard hid, so the
  // shell lands exactly on the visible window.
  assert.equal(insets.offset + insets.height, 844 - 508);
});

test('a shift larger than the hidden area never yields a negative bottom inset', () => {
  const insets = computeKeyboardInsets(844, 508, 400);

  assert.deepEqual(insets, { offset: 336, height: 0 });
});
