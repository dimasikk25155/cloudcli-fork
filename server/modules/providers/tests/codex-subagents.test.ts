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

test('named collaboration replies restore the card and result, without treating progress as completion', async () => {
  const uiPath = '../../../../src/components/chat/hooks/useChatMessages.ts';
  const { normalizedToChatMessages } = await import(uiPath);
  const base = { sessionId: 'parent', provider: 'codex' as const, timestamp: '2026-11-02T03:00:00Z' };
  const rows = [
    { ...base, id: 'spawn', kind: 'tool_use' as const, toolId: 'spawn', toolName: 'collaboration.spawn_agent', toolInput: { task_name: 'check', message: 'Check the result' } },
    { ...base, id: 'out', kind: 'tool_result' as const, toolId: 'spawn', content: '{"task_name":"/root/check"}' },
    { ...base, id: 'progress', kind: 'status' as const, codexHelper: { type: 'agent_message', author: '/root/check', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: MESSAGE\nTask name: /root\nSender: /root/check\nPayload: still checking' }] } },
  ];
  const pending = normalizedToChatMessages(codexSubagentHistory(rows));
  assert.equal(pending.find((row: any) => row.toolId === 'spawn')?.subagentState?.isComplete, false);
  const final = { ...base, id: 'final', kind: 'status' as const, codexHelper: { type: 'agent_message', author: '/root/check', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/check\nPayload: verified result' }] } };
  const history = codexSubagentHistory([...rows, final, final]);
  const notification = history.filter(row => row.kind === 'task_notification');
  assert.equal(notification.length, 1);
  assert.equal(notification[0].summary, 'verified result');
  const card = normalizedToChatMessages(history).find((row: any) => row.toolId === 'spawn');
  assert.equal(card?.subagentState?.isComplete, true);
  assert.equal(card?.toolResult?.content, 'verified result');
  const earlier = { ...notification[0], summary: '' };
  const liveCard = normalizedToChatMessages([...codexSubagentHistory(rows), earlier, notification[0]])
    .find((row: any) => row.toolId === 'spawn');
  assert.equal(liveCard?.toolResult?.content, 'verified result');
  assert.ok(!history.some(row => row.codexHelper));
});

test('structured activity links thread/path, enriches one terminal result, and followup opens a separate cycle', () => {
  const tracker = new CodexSubagentTracker();
  const base = { sessionId: 'parent', provider: 'codex' as const, timestamp: '2026-11-02T03:00:00Z' };
  const activity = (id: string, kind: string) => ({ type: 'SubAgentActivity', id, kind, agent_thread_id: 'uuid', agent_path: '/root/check' });
  tracker.message({ ...base, id: 'spawn', kind: 'tool_use', toolId: 'spawn', toolName: 'functions.collaboration.spawn_agent' });
  assert.deepEqual(tracker.record(activity('spawn', 'started'), 'parent', 'start'), []);
  tracker.message({ ...base, id: 'wait', kind: 'tool_use', toolId: 'wait', toolName: 'collaboration.wait_agent' });
  assert.equal(tracker.message({ ...base, id: 'wait-out', kind: 'tool_result', toolId: 'wait', content: '{"timed_out":false,"message":"activity available"}' }).length, 1);
  const completed = tracker.record(activity('different-terminal-id', 'completed'), 'parent', 'end');
  assert.equal(completed[0].toolId, 'spawn');
  const final = { type: 'agent_message', author: '/root/check', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/check\nPayload: checked' }] };
  const result = tracker.record(final, 'parent', 'final');
  assert.equal(result[0].id, completed[0].id);
  assert.equal(result[0].summary, 'checked');
  tracker.message({ ...base, id: 'send', kind: 'tool_use', toolId: 'send', toolName: 'collaboration.send_message', toolInput: { target: 'check' } });
  assert.deepEqual(tracker.record(activity('send', 'interacted'), 'parent', 'sent'), []);
  assert.deepEqual(tracker.record(activity('end2', 'completed'), 'parent', 'duplicate-end'), []);
  const followup = tracker.message({ ...base, id: 'follow', kind: 'tool_use', toolId: 'follow', toolName: 'collaboration.followup_task', toolInput: { target: 'check', message: 'Check again' } });
  assert.equal(followup[0].toolName, 'spawn_agent');
  assert.deepEqual(tracker.record(final, 'parent', 'final'), []);
  assert.equal(tracker.record(activity('follow', 'interacted'), 'parent', 'follow-start').length, 0);
  assert.equal(tracker.record(activity('new-end', 'completed'), 'parent', 'follow-end')[0].toolId, 'follow');
});
