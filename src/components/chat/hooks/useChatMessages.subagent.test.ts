import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore.js';

import { normalizedToChatMessages } from './useChatMessages.js';

// Ids follow the real session in
// server/modules/providers/tests/fixtures/claude-subagent-sidechain.jsonl.
const AGENT_CALL = 'toolu_014GgZY3RstfgBKrcfVoaveg';
const CHILD_CALL = 'toolu_child_read';
const base = { sessionId: 's', provider: 'claude' as const, timestamp: '2026-10-11T22:26:15.134Z' };

const agentUse: NormalizedMessage = {
  ...base,
  id: 'agent_use',
  kind: 'tool_use',
  toolName: 'Agent',
  toolId: AGENT_CALL,
  toolInput: { description: 'Fixture subagent task', subagent_type: 'general-purpose', prompt: 'Обезличенный промпт' },
};

test('Agent renders as the subagent card with live child tools; nothing from inside it is a user bubble', () => {
  const chat = normalizedToChatMessages([
    agentUse,
    // A subagent row that slipped through as text must still never be the human's bubble.
    { ...base, id: 'sub_prompt', kind: 'text', role: 'user', content: 'Обезличенный промпт', parentToolUseId: AGENT_CALL },
    { ...base, id: 'sub_use', kind: 'tool_use', toolName: 'Read', toolId: CHILD_CALL, toolInput: { file_path: '/tmp/x' }, parentToolUseId: AGENT_CALL },
    { ...base, id: 'sub_res', kind: 'tool_result', toolId: CHILD_CALL, content: 'fixture output', parentToolUseId: AGENT_CALL },
  ]);

  assert.equal(chat.filter((message) => message.type === 'user').length, 0);
  assert.equal(chat.length, 1);
  const [card] = chat;
  assert.equal(card.isSubagentContainer, true);
  assert.deepEqual(card.subagentState?.childTools.map((tool) => [tool.toolId, tool.toolResult?.content]), [
    [CHILD_CALL, 'fixture output'],
  ]);
});

test('history child tools and the same live child tool are not doubled', () => {
  const chat = normalizedToChatMessages([
    { ...agentUse, subagentTools: [{ toolId: CHILD_CALL, toolName: 'Read', toolInput: {}, toolResult: { content: 'x', isError: false } }] },
    { ...base, id: 'sub_use', kind: 'tool_use', toolName: 'Read', toolId: CHILD_CALL, toolInput: {}, parentToolUseId: AGENT_CALL },
  ]);
  assert.deepEqual(chat[0].subagentState?.childTools.map((tool) => tool.toolId), [CHILD_CALL]);
});

test('legacy Task stays a subagent card', () => {
  const chat = normalizedToChatMessages([{ ...agentUse, toolName: 'Task' }]);
  assert.equal(chat[0].isSubagentContainer, true);
});
