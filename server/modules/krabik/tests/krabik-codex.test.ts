import assert from 'node:assert/strict';
import test from 'node:test';

import { createKrabikService, parseAgentGet, parseTranscript } from '../krabik.service.js';

const row = (type: string, payload: unknown) => JSON.stringify({ type, timestamp: '2026-11-01T13:00:00Z', payload });
const user = (text: string) => row('response_item', {
  type: 'message', role: 'user', content: [{ type: 'input_text', text }],
  internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.text'] },
});
const assistant = (text: string) => row('response_item', {
  type: 'message', role: 'assistant', content: [{ type: 'output_text', text }],
});

test('Krabik reads native Codex history without duplicating transport events or exposing context', () => {
  const jsonl = [
    'truncated first line',
    row('session_meta', { cwd: '/home/agents/krabik' }),
    row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_INSTRUCTIONS' }] }),
    user('Проверь службы'), row('event_msg', { type: 'user_message', message: 'Проверь службы' }),
    row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'cmd', arguments: JSON.stringify({ cmd: 'systemctl --failed' }) }),
    row('response_item', { type: 'function_call_output', output: 'PRIVATE_TOOL_OUTPUT' }),
    row('response_item', { type: 'reasoning', summary: [{ text: 'PRIVATE_REASONING' }] }),
    assistant('Службы работают.'), row('event_msg', { type: 'agent_message', message: 'Службы работают.' }),
  ].join('\n');
  const messages = parseTranscript(jsonl);
  assert.deepEqual(messages.map(({ role }) => role), ['user', 'tool', 'assistant']);
  assert.equal(messages[0].text, 'Проверь службы');
  assert.match(messages[1].text, /systemctl --failed/);
  assert.equal(messages[2].text, 'Службы работают.');
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_/);
});

test('Codex questions and patch steps stay visible, raw patch content stays hidden', () => {
  const messages = parseTranscript([
    user('Исправь настройку'),
    row('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: /opt/bot/config.py\n+PRIVATE_PATCH\n*** End Patch' }),
    row('response_item', { type: 'function_call', name: 'request_user_input', arguments: JSON.stringify({ questions: [{ question: 'Перезапустить?', options: [{ label: 'Да' }, { label: 'Нет' }] }] }) }),
  ].join('\n'));
  assert.equal(messages[1].text, 'правит config.py');
  assert.equal(messages[2].role, 'assistant');
  assert.match(messages[2].text, /Перезапустить\?/);
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_PATCH/);
  assert.equal(parseTranscript([user('Раз'), assistant('Готово'), user('Два'), assistant('Готово')].join('\n')).length, 4);
});

test('Herdr exposes the actual Codex engine to the Krabik panel', () => {
  const state = parseAgentGet(JSON.stringify({ result: { agent: { agent: 'codex', agent_status: 'idle', completion_seq: 2 } } }));
  assert.equal((state as { provider?: string }).provider, 'codex');
});

test('Codex prompt delivery does not inherit the Claude-specific extra Enter workaround', async () => {
  const calls: string[][] = [];
  const service = createKrabikService({
    exec: async (_file, args) => {
      calls.push(args);
      return JSON.stringify({ result: { agent: { agent: 'codex', agent_status: 'working' } } });
    },
    sleep: async () => { throw new Error('Codex must not enter the Claude workaround'); },
  });
  await service.sendPrompt('Проверь службы');
  assert.equal(calls.filter((args) => args[3] === 'prompt').length, 1);
  assert.equal(calls.some((args) => args[3] === 'send-keys'), false);
});
