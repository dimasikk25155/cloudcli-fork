import assert from 'node:assert/strict';
import test from 'node:test';

import { SAFARI_IME_RACE_WINDOW_MS, isImeOwnedKey } from './imeComposition.js';

const base = { key: 'Enter', nativeIsComposing: false, trackedComposing: false, now: 10_000, lastCompositionEndAt: 0 };

test('plain Enter without any composition is not owned by the IME', () => {
  assert.equal(isImeOwnedKey(base), false);
});

test('Enter during native or tracked composition is owned by the IME', () => {
  assert.equal(isImeOwnedKey({ ...base, nativeIsComposing: true }), true);
  assert.equal(isImeOwnedKey({ ...base, trackedComposing: true }), true);
});

test('Safari order: compositionend fired just before the confirming Enter keydown', () => {
  assert.equal(isImeOwnedKey({ ...base, lastCompositionEndAt: base.now - 2 }), true);
});

test('a deliberate Enter after the race window sends normally', () => {
  assert.equal(isImeOwnedKey({ ...base, lastCompositionEndAt: base.now - SAFARI_IME_RACE_WINDOW_MS }), false);
  assert.equal(isImeOwnedKey({ ...base, lastCompositionEndAt: base.now - 150 }), false);
});

test('the post-composition window only swallows Enter, not other keys', () => {
  assert.equal(isImeOwnedKey({ ...base, key: 'ArrowUp', lastCompositionEndAt: base.now - 2 }), false);
  assert.equal(isImeOwnedKey({ ...base, key: 'ArrowUp', trackedComposing: true }), true);
});
