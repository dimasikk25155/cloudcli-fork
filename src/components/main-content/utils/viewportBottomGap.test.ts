import assert from 'node:assert/strict';
import test from 'node:test';

import { computeViewportBottomGap } from './viewportBottomGap.js';

// Numbers from Dima's iPhone screenshots of 23.11 (IMG_0085–0087): a 393×852 pt
// screen, the app ends at 798 pt and the bottom 54 pt are painted by the page
// background — «чёрное пятно».
test('installed app on an iPhone that stops 54 pt above the screen edge → gap 54', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 798 }),
    54,
  );
});

test('the app reaching the screen edge → no gap', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 852 }),
    0,
  );
});

test('iOS reports the portrait screen size in landscape too — compare with the short side', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, screenWidth: 393, screenHeight: 852, innerWidth: 852, innerHeight: 393 }),
    0,
  );
});

test('a browser tab (not installed) keeps the safe-area padding as before', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: false, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 740 }),
    0,
  );
});

test('a keyboard-sized loss is not a gap (Android shrinks the window under the keyboard)', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, screenWidth: 412, screenHeight: 915, innerWidth: 412, innerHeight: 560 }),
    0,
  );
});
