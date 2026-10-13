import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROMPT_CACHE_TTL_MIN,
  getPromptCacheTtlMin,
  lastModelActivityAt,
  latestTimestamp,
  normalizePromptCacheTtl,
  promptCacheApplies,
  promptCacheChipLabel,
  promptCacheCompactLabel,
  promptCacheExplanation,
  promptCacheHubNote,
  promptCacheStatus,
  setPromptCacheTtlMin,
} from './promptCache.js';

const MIN = 60_000;
const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const after = (minutes: number) => promptCacheStatus({ lastModelAt: NOW - minutes * MIN, isRunning: false, now: NOW, ttlMin: 60 });

test('0 min after the last model reply: full hour left, warm', () => {
  const status = after(0);
  assert.deepEqual(status, { state: 'warm', minutesLeft: 60, expiresAt: NOW + 60 * MIN });
  assert.equal(promptCacheChipLabel(status), 'Кэш 60 мин');
  assert.equal(promptCacheHubNote(status), 'кэш остынет через 60 мин');
});

test('50 min: exactly 10 left is still warm (yellow is "fewer than 10")', () => {
  const status = after(50);
  assert.equal(status.state, 'warm');
  assert.equal(status.minutesLeft, 10);
  assert.equal(promptCacheChipLabel(status), 'Кэш 10 мин');
});

test('just past 51 min: 9 whole minutes left turns yellow', () => {
  const status = after(51);
  assert.equal(status.state, 'cooling');
  assert.equal(status.minutesLeft, 9);
});

test('59 min: one minute left, cooling', () => {
  const status = after(59);
  assert.equal(status.state, 'cooling');
  assert.equal(status.minutesLeft, 1);
  assert.equal(promptCacheChipLabel(status), 'Кэш 1 мин');
  assert.equal(promptCacheHubNote(status), 'кэш остынет через 1 мин');
});

test('59 min 59 s rounds up to 1 min, never shows 0 while still warm', () => {
  const status = promptCacheStatus({ lastModelAt: NOW - 60 * MIN + 1000, isRunning: false, now: NOW });
  assert.equal(status.state, 'cooling');
  assert.equal(status.minutesLeft, 1);
});

test('exactly 60 min: cache is cold', () => {
  const status = after(60);
  assert.equal(status.state, 'cold');
  assert.equal(status.minutesLeft, 0);
  assert.equal(promptCacheChipLabel(status), 'Кэш остыл');
  assert.equal(promptCacheHubNote(status), 'кэш остыл');
});

test('more than 60 min: still cold', () => {
  assert.equal(after(61).state, 'cold');
  assert.equal(after(60 * 24).state, 'cold');
});

test('a running turn wins over any timestamp', () => {
  for (const lastModelAt of [NOW - 120 * MIN, NOW, null]) {
    const status = promptCacheStatus({ lastModelAt, isRunning: true, now: NOW });
    assert.deepEqual(status, { state: 'running', minutesLeft: null, expiresAt: null });
    assert.equal(promptCacheChipLabel(status), 'Кэш: идёт ход');
    assert.equal(promptCacheHubNote(status), null);
  }
});

test('no data: unknown, no chip and no hub note', () => {
  for (const lastModelAt of [null, undefined, Number.NaN, 0]) {
    const status = promptCacheStatus({ lastModelAt, isRunning: false, now: NOW });
    assert.equal(status.state, 'unknown');
    assert.equal(promptCacheChipLabel(status), null);
    assert.equal(promptCacheHubNote(status), null);
  }
});

test('a timestamp in the future (clock skew) counts as just now', () => {
  const status = promptCacheStatus({ lastModelAt: NOW + 5 * MIN, isRunning: false, now: NOW });
  assert.equal(status.state, 'warm');
  assert.equal(status.minutesLeft, 60);
});

test('TTL override: 5-minute cache is cold after 5 min, bad values fall back to 60', () => {
  assert.equal(promptCacheStatus({ lastModelAt: NOW - 5 * MIN, isRunning: false, now: NOW, ttlMin: 5 }).state, 'cold');
  assert.equal(promptCacheStatus({ lastModelAt: NOW - 4 * MIN, isRunning: false, now: NOW, ttlMin: 5 }).minutesLeft, 1);
  assert.equal(normalizePromptCacheTtl('30'), 30);
  for (const bad of ['', 'abc', -1, 0, Number.NaN, 100_000, null, undefined]) {
    assert.equal(normalizePromptCacheTtl(bad), DEFAULT_PROMPT_CACHE_TTL_MIN);
  }
  setPromptCacheTtlMin('45');
  assert.equal(getPromptCacheTtlMin(), 45);
  setPromptCacheTtlMin('junk');
  assert.equal(getPromptCacheTtlMin(), 60);
  assert.match(promptCacheExplanation(45), /После 45 минут без ответа модели/);
});

test('only Claude sessions on Anthropic models get the timer', () => {
  assert.equal(promptCacheApplies('claude', 'opus[1m]'), true);
  assert.equal(promptCacheApplies('claude', null), true);
  assert.equal(promptCacheApplies('codex', 'gpt-5'), false);
  assert.equal(promptCacheApplies('grok', 'grok-4.7'), false);
  assert.equal(promptCacheApplies('claude', 'local-qwen35-agent'), false);
  assert.equal(promptCacheApplies('claude', 'MiniMax-M2'), false);
  assert.equal(promptCacheApplies('claude', 'glm-4.6'), false);
  assert.equal(promptCacheApplies('claude', 'kimi-k3'), false);
});

test('last model activity: newest assistant output, service turns included, user/tool results skipped', () => {
  const messages = [
    { kind: 'text', role: 'user', timestamp: '2026-10-13T10:00:00.000Z' },
    { kind: 'text', role: 'assistant', timestamp: '2026-10-13T10:01:00.000Z' },
    { kind: 'tool_use', timestamp: '2026-10-13T10:02:00.000Z' },
    { kind: 'tool_result', timestamp: '2026-10-13T10:03:00.000Z' },
    { kind: 'text', role: 'user', timestamp: '2026-10-13T10:05:00.000Z' },
  ];
  assert.equal(lastModelActivityAt(messages), Date.parse('2026-10-13T10:02:00.000Z'));
  assert.equal(lastModelActivityAt([...messages, { kind: 'thinking', timestamp: '2026-10-13T10:06:00.000Z' }]), Date.parse('2026-10-13T10:06:00.000Z'));
  assert.equal(lastModelActivityAt([{ kind: 'text', role: 'user', timestamp: '2026-10-13T10:00:00.000Z' }]), null);
  assert.equal(lastModelActivityAt([]), null);
  assert.equal(lastModelActivityAt([{ kind: 'text', role: 'assistant', timestamp: 'garbage' }]), null);
});

test('latest timestamp across sources', () => {
  assert.equal(latestTimestamp(null, undefined), null);
  assert.equal(latestTimestamp(1000, '1970-01-01T00:00:02.000Z', null), 2000);
  assert.equal(latestTimestamp('nope', 5), 5);
});

test('compact phone label: «42м», «остыл», «ход», nothing without data', () => {
  assert.equal(promptCacheCompactLabel(after(18)), '42м');
  assert.equal(promptCacheCompactLabel(after(59)), '1м');
  assert.equal(promptCacheCompactLabel(after(60)), 'остыл');
  assert.equal(promptCacheCompactLabel(promptCacheStatus({ lastModelAt: null, isRunning: true, now: NOW })), 'ход');
  assert.equal(promptCacheCompactLabel(promptCacheStatus({ lastModelAt: null, isRunning: false, now: NOW })), null);
});
