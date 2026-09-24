import assert from 'node:assert/strict';
import test from 'node:test';

import { isBackdropDismiss, shouldCloseSettingsOnEscape } from './settingsDismiss.js';

const esc = { key: 'Escape', repeat: false, defaultPrevented: false };

test('Escape closes settings when nothing is layered above it', () => {
  assert.equal(shouldCloseSettingsOnEscape(esc, false), true);
});

test('Escape goes to the top layer first (menu, dialog, login modal)', () => {
  assert.equal(shouldCloseSettingsOnEscape(esc, true), false);
});

test('other keys, auto-repeat and already-consumed Escape do not close settings', () => {
  assert.equal(shouldCloseSettingsOnEscape({ ...esc, key: 'Enter' }, false), false);
  assert.equal(shouldCloseSettingsOnEscape({ ...esc, repeat: true }, false), false);
  assert.equal(shouldCloseSettingsOnEscape({ ...esc, defaultPrevented: true }, false), false);
  assert.equal(shouldCloseSettingsOnEscape({ ...esc, isComposing: true }, false), false, 'IME cancel');
});

test('backdrop closes only when the click starts and ends on it', () => {
  assert.equal(isBackdropDismiss(true, true), true);
  assert.equal(isBackdropDismiss(false, true), false, 'text selection dragged out of the panel');
  assert.equal(isBackdropDismiss(true, false), false);
});
