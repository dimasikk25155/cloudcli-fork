import assert from 'node:assert/strict';
import test from 'node:test';

import { GrokSessionsProvider } from '@/modules/providers/list/grok/grok-sessions.provider.js';

const provider = new GrokSessionsProvider();
const SESSION = '11111111-2222-3333-4444-555555555555';

/**
 * Live payloads below are verbatim from `grok -p --output-format
 * streaming-messages-json` on grok 1.0.5 (trimmed to the fields the provider
 * reads).
 */

test('system/init carries no UI payload', () => {
  const result = provider.normalizeMessage(
    { type: 'system', subtype: 'init', session_id: SESSION, model: 'grok-4.6', tools: ['read_file'] },
    SESSION,
  );
  assert.deepEqual(result, []);
});

test('assistant content blocks become text, thinking and tool_use rows', () => {
  const result = provider.normalizeMessage({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'grok-4.6',
      content: [
        { type: 'thinking', thinking: 'The user wants the hostname.' },
        { type: 'text', text: 'Читаю /etc/hostname.' },
        { type: 'tool_use', id: 'call-abc-0', name: 'read_file', input: { target_file: '/etc/hostname' } },
      ],
    },
  }, SESSION);

  assert.equal(result.length, 3);
  assert.equal(result[0].kind, 'thinking');
  assert.equal(result[1].kind, 'text');
  assert.equal(result[1].role, 'assistant');
  assert.equal(result[1].content, 'Читаю /etc/hostname.');
  assert.equal(result[2].kind, 'tool_use');
  assert.equal(result[2].toolName, 'read_file');
  assert.equal(result[2].toolId, 'call-abc-0');
  assert.equal(result[2].id, 'call-abc-0_call');
});

test('empty text blocks are dropped instead of rendering blank bubbles', () => {
  const result = provider.normalizeMessage({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
  }, SESSION);
  assert.deepEqual(result, []);
});

test('user tool_result blocks become tool_result rows keyed to their call', () => {
  const result = provider.normalizeMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call-abc-0', content: 'urban-face' }],
    },
  }, SESSION);

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'tool_result');
  assert.equal(result[0].toolId, 'call-abc-0');
  assert.equal(result[0].id, 'call-abc-0_result');
  assert.equal(result[0].content, 'urban-face');
});

test('result usage is reported as a token budget on the 500K window', () => {
  const result = provider.normalizeMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    model: 'grok-4.6',
    usage: {
      input_tokens: 40217,
      output_tokens: 707,
      cache_read_input_tokens: 19328,
      cache_creation_input_tokens: 0,
    },
  }, SESSION);

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'status');
  assert.equal(result[0].text, 'token_budget');
  const budget = result[0].tokenBudget as Record<string, number>;
  assert.equal(budget.outputTokens, 707);
  assert.equal(budget.cacheReadTokens, 19328);
  assert.equal(budget.inputTokens, 40217 + 19328);
  assert.equal(budget.used, 40217 + 19328 + 707);
  assert.equal(budget.total, 500_000);
});

test('a cancelled run explains itself instead of ending on silence', () => {
  const result = provider.normalizeMessage({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    stop_reason: 'cancelled',
    usage: { input_tokens: 10, output_tokens: 1 },
  }, SESSION);

  const error = result.find((msg) => msg.kind === 'error');
  assert.ok(error, 'a failed result must surface an error row');
  assert.match(String(error?.content), /Обход разрешений/);
});

test('unknown event types are ignored, never rendered raw', () => {
  assert.deepEqual(provider.normalizeMessage({ type: 'stream_event', delta: {} }, SESSION), []);
  assert.deepEqual(provider.normalizeMessage('not an object', SESSION), []);
  assert.deepEqual(provider.normalizeMessage(null, SESSION), []);
});
