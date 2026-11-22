import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The seam between MainContentHeader (`pwa-header-air`), useViewportBottomGap
// (`--viewport-bottom-gap`) and the stylesheet that turns them into padding.
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const header = readFileSync(new URL('./view/subcomponents/MainContentHeader.tsx', import.meta.url), 'utf8');

test('chat header on a phone in the installed app sits below the blurred status-bar strip', () => {
  const rule = css.match(/@media screen and \(max-width: 767px\) \{\s*body\.pwa-mode \.pwa-header-safe\.pwa-header-air \{([^}]*)\}/);
  assert.ok(rule, 'a phone-only pwa-mode rule for the chat header');
  assert.match(rule[1], /padding-top:\s*var\(--pwa-header-air\)\s*!important/);
  const air = css.match(/--pwa-header-air:\s*(\d+)px/);
  assert.ok(air && Number(air[1]) >= 12, 'some air under the status bar');
  assert.match(header, /className="pwa-header-safe pwa-header-air /);
});

test('bottom padding drops the part of the safe area the app window does not cover', () => {
  assert.match(css, /--safe-bottom:\s*max\(0px,\s*calc\(env\(safe-area-inset-bottom, 0px\) - var\(--viewport-bottom-gap, 0px\)\)\)/);
  assert.match(css, /--composer-bottom-gap:\s*max\(16px,\s*calc\(var\(--safe-bottom/);
});
