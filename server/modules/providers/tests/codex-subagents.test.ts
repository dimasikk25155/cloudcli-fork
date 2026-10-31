import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexSubagentTracker, codexSubagentHistory } from '../list/codex/codex-subagents.js';

test('Codex helper stays running after spawn and finishes only on its own terminal state', () => {
  const tracker = new CodexSubagentTracker();
  const spawn = { id: 'call-1', tool: 'spawn_agent', prompt: 'Inspect code', receiver_thread_ids: ['child-1'], status: 'completed', agents_states: { 'child-1': { status: 'running' } } };
  const rows = tracker.event(spawn, 'parent', 'gpt-6.1-sol');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'tool_use');
  assert.equal(rows[0].toolName, 'spawn_agent');
  assert.deepEqual(tracker.event(spawn, 'parent'), []);
  const done = { id: 'wait-1', tool: 'wait', agents_states: { 'child-1': { status: 'completed', message: 'verified' } } };
  assert.deepEqual(tracker.event(done, 'parent').map(({ kind, toolId, status }) => ({ kind, toolId, status })), [
    { kind: 'task_notification', toolId: 'call-1', status: 'completed' },
  ]);
  assert.deepEqual(tracker.event(done, 'parent'), []);
});

test('Codex helper failure is terminal; an unknown helper never closes another crab', () => {
  const tracker = new CodexSubagentTracker();
  tracker.event({ id: 'a', tool: 'spawn_agent', receiver_thread_ids: ['known'] }, 'parent');
  assert.deepEqual(tracker.event({ id: 'w', tool: 'wait', agents_states: { stranger: { status: 'completed' } } }, 'parent'), []);
  const result = tracker.event({ id: 'w', tool: 'wait', agents_states: { known: { status: 'errored' } } }, 'parent');
  assert.equal(result[0].status, 'failed');
  assert.equal(result[0].toolId, 'a');
});


test('Codex helper history preserves async state until wait returns completion', () => {
  const messages = codexSubagentHistory([
    { id: 'spawn', kind: 'tool_use', toolId: 'spawn', toolName: 'spawn_agent', toolInput: '{"message":"inspect"}', sessionId: 'parent', provider: 'codex', timestamp: '2026-10-31' },
    { id: 'spawn-result', kind: 'tool_result', toolId: 'spawn', content: '{"agent_id":"child"}', sessionId: 'parent', provider: 'codex', timestamp: '2026-10-31' },
    { id: 'wait', kind: 'tool_use', toolId: 'wait', toolName: 'wait', sessionId: 'parent', provider: 'codex', timestamp: '2026-10-31' },
    { id: 'wait-result', kind: 'tool_result', toolId: 'wait', content: '{"status":{"child":{"completed":"done"}},"timed_out":false}', sessionId: 'parent', provider: 'codex', timestamp: '2026-10-31' },
  ]);
  assert.equal((messages[0].toolInput as { run_in_background: boolean }).run_in_background, true);
  assert.equal(messages.at(-1)?.kind, 'task_notification');
  assert.equal(messages.at(-1)?.toolId, 'spawn');
  assert.equal(messages.at(-1)?.status, 'completed');
});
