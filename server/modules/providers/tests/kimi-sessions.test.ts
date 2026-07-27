import assert from 'node:assert/strict';
import test from 'node:test';

import { KimiSessionsProvider } from '@/modules/providers/list/kimi/kimi-sessions.provider.js';

const provider = new KimiSessionsProvider();

test('Kimi normalizeMessage maps assistant text chunks', () => {
  const messages = provider.normalizeMessage({ role: 'assistant', content: 'KIMI OK' }, 's1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].content, 'KIMI OK');
  assert.equal(messages[0].provider, 'kimi');
});

test('Kimi normalizeMessage maps tool_calls with JSON-string arguments', () => {
  const messages = provider.normalizeMessage({
    role: 'assistant',
    tool_calls: [
      {
        type: 'function',
        id: 'tool_An4DcZ5txd3PdrwwwwFB9H9G',
        function: { name: 'Bash', arguments: '{"command":"ls -la"}' },
      },
    ],
  }, 's1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_use');
  assert.equal(messages[0].toolName, 'Bash');
  assert.deepEqual(messages[0].toolInput, { command: 'ls -la' });
  assert.equal(messages[0].toolId, 'tool_An4DcZ5txd3PdrwwwwFB9H9G');
});

test('Kimi normalizeMessage keeps unparseable tool arguments as raw text', () => {
  const messages = provider.normalizeMessage({
    role: 'assistant',
    tool_calls: [
      { type: 'function', id: 'tool_1', function: { name: 'Read', arguments: '{broken' } },
    ],
  }, 's1');

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].toolInput, { raw: '{broken' });
});

test('Kimi normalizeMessage maps tool result events onto tool_result', () => {
  const messages = provider.normalizeMessage(
    { role: 'tool', tool_call_id: 'tool_1', content: 'total 8' },
    's1',
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'tool_1');
  assert.equal(messages[0].content, 'total 8');
});

test('Kimi normalizeMessage drops meta resume_hint lines', () => {
  const messages = provider.normalizeMessage(
    {
      role: 'meta',
      type: 'session.resume_hint',
      session_id: 'session_a99dbf5e-2113-40bb-83c9-c5e7902a74ec',
      command: 'kimi -r session_a99dbf5e-2113-40bb-83c9-c5e7902a74ec',
    },
    's1',
  );

  assert.deepEqual(messages, []);
});

test('Kimi normalizeMessage ignores unknown event shapes', () => {
  assert.deepEqual(provider.normalizeMessage(null, 's1'), []);
  assert.deepEqual(provider.normalizeMessage('not an object', 's1'), []);
  assert.deepEqual(provider.normalizeMessage({ role: 'system' }, 's1'), []);
});
