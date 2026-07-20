import assert from 'node:assert/strict';
import test from 'node:test';

import {
  USAGE_GUARD_DEFAULT_PCT,
  buildUsageGuardNotice,
  formatResetMoscow,
  resolveUsageGuardThreshold,
  type UsageGuardState,
} from '@/shared/claude-usage.js';

function withGuardPct(value: string | undefined, run: () => void): void {
  const original = process.env.USAGE_GUARD_PCT;
  if (value === undefined) {
    delete process.env.USAGE_GUARD_PCT;
  } else {
    process.env.USAGE_GUARD_PCT = value;
  }
  try {
    run();
  } finally {
    if (original === undefined) {
      delete process.env.USAGE_GUARD_PCT;
    } else {
      process.env.USAGE_GUARD_PCT = original;
    }
  }
}

test('threshold defaults to the exported default when the env var is unset', () => {
  withGuardPct(undefined, () => {
    assert.equal(resolveUsageGuardThreshold(), USAGE_GUARD_DEFAULT_PCT);
    assert.equal(USAGE_GUARD_DEFAULT_PCT, 90);
  });
});

test('a valid in-range override is honoured', () => {
  withGuardPct('50', () => {
    assert.equal(resolveUsageGuardThreshold(), 50);
  });
});

test('fractional overrides inside the range are kept as-is', () => {
  withGuardPct('42.5', () => {
    assert.equal(resolveUsageGuardThreshold(), 42.5);
  });
});

test('boundary and out-of-range overrides fall back to the default', () => {
  for (const bad of ['0', '100', '-5', '150', 'abc', '', 'NaN']) {
    withGuardPct(bad, () => {
      assert.equal(
        resolveUsageGuardThreshold(),
        USAGE_GUARD_DEFAULT_PCT,
        `override "${bad}" should be rejected`,
      );
    });
  }
});

test('formatResetMoscow renders a UTC instant in Moscow wall-clock time', () => {
  // Moscow is a fixed UTC+3 (no DST since 2014): 09:00Z -> 12:00 MSK.
  assert.equal(formatResetMoscow('2026-07-20T09:00:00Z'), '12:00 МСК');
});

test('formatResetMoscow applies the +3 offset across a day boundary', () => {
  // 22:30Z the previous day is 01:30 MSK the next day.
  assert.equal(formatResetMoscow('2026-07-19T22:30:00Z'), '01:30 МСК');
});

test('formatResetMoscow returns "неизвестно" for a null timestamp', () => {
  assert.equal(formatResetMoscow(null), 'неизвестно');
});

test('buildUsageGuardNotice reports a rounded percentage and the reset time', () => {
  const guard: UsageGuardState = {
    blocked: true,
    pct: 94.6,
    threshold: 90,
    resetsAt: '2026-07-20T09:00:00Z',
  };
  const notice = buildUsageGuardNotice(guard);
  const lines = notice.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(
    lines[0],
    '⛔ Использовано 95% 5-часового лимита подписки (порог 90%).',
  );
  assert.ok(lines[2].includes('12:00 МСК'), `reset line should carry Moscow time: ${lines[2]}`);
});

test('buildUsageGuardNotice shows "≥threshold" when the exact percentage is unknown', () => {
  const guard: UsageGuardState = {
    blocked: false,
    pct: null,
    threshold: 90,
    resetsAt: null,
  };
  const notice = buildUsageGuardNotice(guard);
  const lines = notice.split('\n');
  assert.equal(
    lines[0],
    '⛔ Использовано ≥90% 5-часового лимита подписки (порог 90%).',
  );
  assert.ok(lines[2].includes('неизвестно'), `reset line should read неизвестно: ${lines[2]}`);
});
