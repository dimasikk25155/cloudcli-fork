import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCollapseMenu } from './sidebarMenuState';

// On a phone the drawer stays mounted (hidden with `invisible`/`-translate-x-full`),
// so «Меню» has to fold itself each time the drawer slides in (spec R06).
test('phone: every opening of the drawer folds the menu', () => {
  assert.equal(shouldCollapseMenu(false, true), true);
});

test('phone: closing the drawer or a re-render while it stays put leaves the menu alone', () => {
  assert.equal(shouldCollapseMenu(true, false), false);
  assert.equal(shouldCollapseMenu(true, true), false);
  assert.equal(shouldCollapseMenu(false, false), false);
});

test('computer: no drawer signal, the menu only folds on mount as before', () => {
  assert.equal(shouldCollapseMenu(undefined, undefined), false);
});
