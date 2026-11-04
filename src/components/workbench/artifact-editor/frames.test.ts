import assert from 'node:assert/strict';
import test from 'node:test';

import { moveFrame, pickFrameSet, type FrameCandidate } from './frames';

// Frames of a slide deck: the first set of ≥2 among `[data-slide]`, `.slide`,
// `section` sharing one parent; dragging a thumbnail gives the new order.

const c = (id: string, parentKey: string, rule: number): FrameCandidate => ({ id, parentKey, rule });

test('[data-slide] wins over .slide and section; a lone match is not a deck', () => {
  assert.deepEqual(pickFrameSet([
    c('1', 'body', 2), c('2', 'body', 2),
    c('3', 'main', 1), c('4', 'main', 1),
    c('5', 'deck', 0), c('6', 'deck', 0), c('7', 'deck', 0),
  ]), ['5', '6', '7']);
  assert.deepEqual(pickFrameSet([c('9', 'x', 0), c('3', 'main', 1), c('4', 'main', 1)]), ['3', '4'], 'one [data-slide] — the next rule');
});

test('within one rule the first parent (in document order) with ≥2 matches is the set', () => {
  assert.deepEqual(pickFrameSet([
    c('2', 'header', 2),
    c('5', 'main', 2), c('8', 'aside', 2), c('6', 'main', 2), c('7', 'main', 2), c('9', 'aside', 2),
  ]), ['5', '6', '7']);
});

test('nothing repeats under one parent — no frames', () => {
  assert.deepEqual(pickFrameSet([c('1', 'a', 2), c('2', 'b', 2), c('3', 'c', 1)]), []);
  assert.deepEqual(pickFrameSet([]), []);
});

test('moveFrame: a dragged frame lands at the target index, others keep their order', () => {
  assert.deepEqual(moveFrame(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveFrame(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveFrame(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveFrame(['a', 'b', 'c'], 5, 0), ['a', 'b', 'c'], 'out of range — unchanged');
  assert.deepEqual(moveFrame(['a', 'b', 'c'], 0, 9), ['b', 'c', 'a'], 'past the end — to the end');
});
