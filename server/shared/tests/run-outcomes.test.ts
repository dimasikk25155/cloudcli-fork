import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRunInterruptedNotice, isTransientRunFailure } from '@/shared/run-outcomes.js';

const PREFIX = '⏹ Прогон прерван — финального ответа нет.';
const SUFFIX = 'Отправь сообщение заново, чтобы продолжить.';

function causeLine(notice: string): string {
  const line = notice.split('\n').find((l) => l.startsWith('Причина: '));
  assert.ok(line, `notice should carry a "Причина:" line, got:\n${notice}`);
  return line!.slice('Причина: '.length);
}

test('every notice is wrapped with the fixed prefix and retry suffix', () => {
  const notice = buildRunInterruptedNotice('anything');
  const lines = notice.split('\n');
  assert.equal(lines[0], PREFIX);
  assert.equal(lines[lines.length - 1], SUFFIX);
  assert.equal(lines.length, 3);
});

test('a bare session limit maps to the reset-unknown copy', () => {
  const notice = buildRunInterruptedNotice('Claude AI usage session limit reached');
  assert.equal(
    causeLine(notice),
    'достигнут лимит подписки Claude — дождись сброса лимита.',
  );
});

test('a session limit keeps the reset time up to the first period', () => {
  const notice = buildRunInterruptedNotice(
    'Session limit reached. Resets 5pm. Extra sentence here.',
  );
  assert.equal(
    causeLine(notice),
    'достигнут лимит подписки Claude — сброс в 5pm.',
  );
});

test('session-limit detection is case-insensitive', () => {
  const notice = buildRunInterruptedNotice('SESSION LIMIT');
  assert.equal(
    causeLine(notice),
    'достигнут лимит подписки Claude — дождись сброса лимита.',
  );
});

test('dropped API connection variants collapse to one message', () => {
  const expected = 'оборвалась связь с API Anthropic посреди ответа — ответ неполный.';
  for (const reason of ['Connection closed', 'closed mid-response', 'connection error']) {
    assert.equal(causeLine(buildRunInterruptedNotice(reason)), expected);
  }
});

test('ede_diagnostic and tool_use stop reasons become the CLI-error copy', () => {
  const expected = 'Claude Code оборвал ход на выполнении инструмента (внутренняя ошибка CLI).';
  assert.equal(
    causeLine(buildRunInterruptedNotice('[ede_diagnostic] boom')),
    expected,
  );
  assert.equal(
    causeLine(buildRunInterruptedNotice('stop_reason=tool_use')),
    expected,
  );
});

test('a "not installed" reason is passed through verbatim, preserving case', () => {
  const reason = 'Claude Code is Not Installed on this host';
  assert.equal(causeLine(buildRunInterruptedNotice(reason)), reason);
});

test('an unrecognised reason is surfaced as-is', () => {
  const reason = 'Some brand new failure';
  assert.equal(causeLine(buildRunInterruptedNotice(reason)), reason);
});

test('null reason falls back to the generic no-final-answer copy', () => {
  assert.equal(
    causeLine(buildRunInterruptedNotice(null)),
    'прогон завершился без финального ответа.',
  );
});

test('empty string is treated like a missing reason', () => {
  assert.equal(
    causeLine(buildRunInterruptedNotice('')),
    'прогон завершился без финального ответа.',
  );
});

test('session limit wins over a co-occurring connection error', () => {
  const notice = buildRunInterruptedNotice('session limit reached, connection closed');
  assert.equal(
    causeLine(notice),
    'достигнут лимит подписки Claude — дождись сброса лимита.',
  );
});

test('an overloaded API maps to the 529 copy', () => {
  const expected =
    'серверы Anthropic перегружены (529) — автоповторы не помогли, обычно отпускает за несколько минут.';
  for (const reason of [
    'Claude Code returned an error result: API Error: 529 Overloaded.',
    'API Error: 529 Overloaded. This is a server-side issue',
  ]) {
    assert.equal(causeLine(buildRunInterruptedNotice(reason)), expected);
  }
});

test('overload copy wins over a co-occurring connection error', () => {
  const notice = buildRunInterruptedNotice('529 Overloaded, connection closed');
  assert.ok(causeLine(notice).startsWith('серверы Anthropic перегружены'));
});

test('server wobbles are retryable', () => {
  for (const reason of [
    'Claude Code returned an error result: API Error: 529 Overloaded.',
    'API Error: 503 Service Unavailable',
    'Bad Gateway',
    'Connection closed mid-response',
    'fetch failed',
    'read ECONNRESET',
  ]) {
    assert.equal(isTransientRunFailure(reason), true, `expected retryable: ${reason}`);
  }
});

test('failures a retry cannot fix are not retryable', () => {
  for (const reason of [
    "You've hit your session limit. Resets 5pm.",
    'Claude AI usage limit reached',
    'Claude Code is not installed',
    'Your credit balance is too low',
    'invalid api key',
    '[ede_diagnostic] result_type=user stop_reason=tool_use',
    'Some brand new failure',
    null,
    '',
  ]) {
    assert.equal(isTransientRunFailure(reason), false, `expected non-retryable: ${reason}`);
  }
});

test('a session limit delivered as a 503 is still not retried', () => {
  assert.equal(isTransientRunFailure('503 — usage limit reached for this session'), false);
});
