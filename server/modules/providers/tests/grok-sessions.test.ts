import assert from 'node:assert/strict';
import test from 'node:test';

import { appendImagesInputTag, appendVisibleImagePathsTag } from '@/shared/image-attachments.js';
import { extractGrokUserTurn, GrokSessionsProvider } from '@/modules/providers/list/grok/grok-sessions.provider.js';

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

test('subagent frames with parent_tool_use_id stay out of the main transcript', () => {
  const result = provider.normalizeMessage({
    type: 'assistant',
    parent_tool_use_id: 'call-subagent-1',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Ищу реальные дыры в репо' },
        { type: 'text', text: 'Сначала сниму карту репо' },
        { type: 'tool_use', id: 'call-child-0', name: 'read_file', input: { target_file: 'x' } },
      ],
    },
  }, SESSION);

  assert.deepEqual(result, []);
});

test('extractGrokUserTurn strips the images_input block that lives inside user_query', () => {
  const tagged = appendVisibleImagePathsTag(
    'ты что на приколе? ты сам себя прерываешь',
    [{ path: '/home/agents/.cloudcli/assets/1787404012576-717085031-image.png', name: 'image.png' }],
  );
  const wrapped = `<user_info>\nOS Version: linux\n</user_info>\n\n<user_query>\n${tagged}\n</user_query>`;
  const turn = extractGrokUserTurn(wrapped);

  assert.equal(turn.text, 'ты что на приколе? ты сам себя прерываешь');
  assert.equal(turn.images?.length, 1);
  assert.match(String(turn.images?.[0]?.path), /1787404012576-717085031-image\.png$/);
  assert.equal(turn.images?.[0]?.name, 'image.png');
  assert.equal(turn.text.includes('<images_input>'), false);
});

test('extractGrokUserTurn also strips the read-the-file images_input variant', () => {
  const tagged = appendImagesInputTag('посмотри скрин', [{ path: '/tmp/a.png' }]);
  const turn = extractGrokUserTurn(`<user_query>\n${tagged}\n</user_query>`);
  assert.equal(turn.text, 'посмотри скрин');
  assert.equal(turn.images?.length, 1);
});

test('history user events drop the images_input leak from the bubble', () => {
  const tagged = appendVisibleImagePathsTag(
    'сравни с эталоном',
    [{ path: '/home/agents/.cloudcli/assets/shot.png', name: 'shot.png' }],
  );
  const messages = provider.normalizeMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call-x', content: 'ok' }],
    },
  }, SESSION);
  assert.equal(messages[0].kind, 'tool_result');

  // History dialect is exercised through extractGrokUserTurn above; live user
  // frames are tool_result-only. Keep this assertion so a live user text
  // payload cannot start leaking the tag either.
  const liveText = provider.normalizeMessage({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: tagged }] },
  }, SESSION);
  assert.deepEqual(liveText, []);
});

test('result.result becomes the answer when no assistant text block streamed', () => {
  const session = 'aaaaaaaa-0000-0000-0000-000000000001';
  const result = provider.normalizeMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    result: 'PONG',
    usage: { input_tokens: 10, output_tokens: 2 },
  }, session);

  const textRows = result.filter((msg) => msg.kind === 'text');
  assert.equal(textRows.length, 1);
  assert.equal(textRows[0].content, 'PONG');
  assert.equal(textRows[0].role, 'assistant');
});

test('result.result is NOT duplicated when assistant text already streamed', () => {
  const session = 'aaaaaaaa-0000-0000-0000-000000000002';
  provider.normalizeMessage({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Ответ уже в чате.' }] },
  }, session);

  const result = provider.normalizeMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    result: 'Ответ уже в чате.',
    usage: { input_tokens: 10, output_tokens: 2 },
  }, session);

  assert.equal(result.filter((msg) => msg.kind === 'text').length, 0);
});

test('an errored result never turns result.result into an answer bubble', () => {
  const session = 'aaaaaaaa-0000-0000-0000-000000000003';
  const result = provider.normalizeMessage({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    stop_reason: 'cancelled',
    result: 'partial garbage',
  }, session);

  assert.equal(result.filter((msg) => msg.kind === 'text').length, 0);
  assert.equal(result.filter((msg) => msg.kind === 'error').length, 1);
});

test('history strips the embedded work_mode_rules tag from the user bubble', () => {
  const turn = extractGrokUserTurn(
    '<user_query><work_mode_rules>\nFollow these session rules.\nWORK MODE: STAGED BRIEFINGS. …\n</work_mode_rules>\n\nСоздай файл с фактами</user_query>',
  );
  assert.equal(turn.text, 'Создай файл с фактами');
});

test('history strips the embedded session_context block from the user bubble', () => {
  const turn = extractGrokUserTurn(
    '<user_query><session_context>\nВНЕШНЯЯ ПАМЯТЬ (вольт Obsidian)…\n</session_context>\n<work_mode_rules>\nRULE\n</work_mode_rules>\n\nПривет</user_query>',
  );
  assert.equal(turn.text, 'Привет');
});
