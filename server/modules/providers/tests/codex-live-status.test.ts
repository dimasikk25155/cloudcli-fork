import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexSessionsProvider } from '../list/codex/codex-sessions.provider.js';

const provider = new CodexSessionsProvider();

test('live reasoning stays thinking rather than becoming an assistant answer', () => {
  const [row] = provider.normalizeMessage({ type: 'item', itemType: 'reasoning', message: {
    role: 'assistant', content: 'fixture reasoning', isReasoning: true,
  } }, 'session');
  assert.equal(row.kind, 'thinking');
});

test('every terminal live tool emits a matching result and keeps its single tool row', () => {
  for (const itemType of ['command_execution', 'mcp_tool_call', 'file_change', 'web_search', 'todo_list']) {
    for (const status of ['completed', 'failed']) {
      const rows = provider.normalizeMessage({ type: 'item', itemType, uuid: 'turn:call', status,
        tool: 'js', output: 'fixture', result: { content: [] }, error: status === 'failed' ? 'failed' : undefined,
      }, 'session');
      assert.equal(rows.length, 2, `${itemType}/${status}`);
      assert.equal(rows[0].kind, 'tool_use');
      assert.equal(rows[1].kind, 'tool_result');
      assert.equal(rows[1].toolId, rows[0].toolId);
      assert.equal(rows[1].isError, status === 'failed');
      assert.notEqual(rows[1].id, rows[0].id);
    }
  }
});

test('live start has no premature result; history user messages still normalize normally', () => {
  assert.equal(provider.normalizeMessage({ type: 'item', itemType: 'mcp_tool_call', status: 'in_progress' }, 'session').length, 1);
  assert.equal(provider.normalizeMessage({ message: { role: 'user', content: 'hello' } }, 'session')[0].role, 'user');
});
