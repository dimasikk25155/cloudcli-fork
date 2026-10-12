import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAppBadge } from './appBadge';

function recordingNavigator() {
  const calls: string[] = [];
  return {
    calls,
    nav: {
      setAppBadge: (count?: number) => {
        calls.push(`set:${count}`);
        return Promise.resolve();
      },
      clearAppBadge: () => {
        calls.push('clear');
        return Promise.resolve();
      },
    },
  };
}

test('N > 0 sets the icon badge to N; N = 0 clears it (R12)', () => {
  const { calls, nav } = recordingNavigator();
  applyAppBadge(4, nav);
  applyAppBadge(0, nav);
  assert.deepEqual(calls, ['set:4', 'clear']);
});

test('no Badging API (Android Chrome, Firefox) — silently skipped', () => {
  assert.doesNotThrow(() => applyAppBadge(3, {}));
  assert.doesNotThrow(() => applyAppBadge(0, undefined));
});

test('a rejected badge call does not surface as an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    applyAppBadge(2, { setAppBadge: () => Promise.reject(new Error('NotAllowedError')) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
