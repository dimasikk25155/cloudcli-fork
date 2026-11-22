import assert from 'node:assert/strict';
import test from 'node:test';

import { computeViewportBottomGap } from './viewportBottomGap.js';

// Numbers from Dima's iPhone screenshots of 23.11 (IMG_0085–0087): a 393×852 pt
// screen, the app ends at 798 pt and the bottom 54 pt are painted by the page
// background — «чёрное пятно».
test('installed app on an iPhone that stops 54 pt above the screen edge → gap 54', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, statusBarStyle: 'black-translucent', safeAreaTop: 59, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 798 }),
    54,
  );
});

test('the app reaching the screen edge → no gap', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, statusBarStyle: 'black-translucent', safeAreaTop: 59, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 852 }),
    0,
  );
});

test('iOS reports the portrait screen size in landscape too — compare with the short side', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, statusBarStyle: 'black-translucent', safeAreaTop: 59, screenWidth: 393, screenHeight: 852, innerWidth: 852, innerHeight: 393 }),
    0,
  );
});

test('a browser tab (not installed) keeps the safe-area padding as before', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: false, statusBarStyle: 'black-translucent', safeAreaTop: 59, screenWidth: 393, screenHeight: 852, innerWidth: 393, innerHeight: 740 }),
    0,
  );
});

test('a keyboard-sized loss is not a gap (Android shrinks the window under the keyboard)', () => {
  assert.equal(
    computeViewportBottomGap({ standalone: true, statusBarStyle: 'black-translucent', safeAreaTop: 59, screenWidth: 412, screenHeight: 915, innerWidth: 412, innerHeight: 560 }),
    0,
  );
});

// Review of task 04: light themes (editorial, glass, claudeLight) switch the
// status bar to `default` (index.html, ThemeContext.jsx). Then the installed
// app legitimately starts under the 54 pt status bar: the difference sits on
// top, the bottom reaches the screen edge, and the composer / «Меню» need the
// full env(safe-area-inset-bottom) above the home indicator.
test('status bar style `default` (light themes): the 54 pt difference is on top → no bottom gap', () => {
  assert.equal(
    computeViewportBottomGap({
      standalone: true,
      statusBarStyle: 'default',
      safeAreaTop: 0,
      screenWidth: 393,
      screenHeight: 852,
      innerWidth: 393,
      innerHeight: 798,
    }),
    0,
  );
});

test('status bar style `black-translucent` (dark themes): the difference is the bottom strip → gap 54', () => {
  assert.equal(
    computeViewportBottomGap({
      standalone: true,
      statusBarStyle: 'black-translucent',
      safeAreaTop: 59,
      screenWidth: 393,
      screenHeight: 852,
      innerWidth: 393,
      innerHeight: 798,
    }),
    54,
  );
});

test('top safe-area inset 0 → the window is under the status bar, no bottom gap even if the meta says translucent', () => {
  // The meta is read by iOS at launch only: after a light → dark switch the
  // meta says `black-translucent`, but the window still sits under the bar.
  assert.equal(
    computeViewportBottomGap({
      standalone: true,
      statusBarStyle: 'black-translucent',
      safeAreaTop: 0,
      screenWidth: 393,
      screenHeight: 852,
      innerWidth: 393,
      innerHeight: 798,
    }),
    0,
  );
});
