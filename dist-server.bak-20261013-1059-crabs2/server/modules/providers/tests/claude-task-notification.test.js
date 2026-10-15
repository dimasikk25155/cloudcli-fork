import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeSessionsProvider, parseTaskNotificationText } from '../../../modules/providers/list/claude/claude-sessions.provider.js';
import { createBackgroundTaskTracker } from '../../../modules/background-tasks/background-tasks.service.js';
const AGENT_CALL = 'toolu_014puK854WG3EB4rEesYRPFL';
// Shape of a real background-agent return (13.10, result text anonymized).
const NOTIFICATION_TEXT = [
    '<task-notification>',
    '<task-id>a2d15558959adbbbc</task-id>',
    `<tool-use-id>${AGENT_CALL}</tool-use-id>`,
    '<output-file>/tmp/a2d15558959adbbbc.output</output-file>',
    '<status>completed</status>',
    '<summary>Agent "Find subagent rendering" finished</summary>',
    '<result>English findings that the human never needs to read.</result>',
    '<usage><subagent_tokens>77211</subagent_tokens><tool_uses>13</tool_uses><duration_ms>60062</duration_ms></usage>',
    '</task-notification>',
].join('\n');
test('parses which Agent call came back, how it ended and its effort', () => {
    assert.deepEqual(parseTaskNotificationText(NOTIFICATION_TEXT), {
        toolId: AGENT_CALL,
        status: 'completed',
        summary: 'Agent "Find subagent rendering" finished',
        usage: { toolUses: 13, durationMs: 60062, totalTokens: 77211 },
    });
    assert.equal(parseTaskNotificationText('plain text'), null);
});
test('history: the non-human notification turn becomes a task_notification row without the result text', () => {
    const provider = new ClaudeSessionsProvider();
    const rows = provider.normalizeMessage({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-10-13T05:59:44.672Z',
        origin: { kind: 'task-notification', producer: 'session-task' },
        message: { role: 'user', content: [{ type: 'text', text: NOTIFICATION_TEXT }] },
    }, 's1');
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.kind, 'task_notification');
    assert.equal(row.toolId, AGENT_CALL);
    assert.equal(row.status, 'completed');
    assert.deepEqual(row.usage, { toolUses: 13, durationMs: 60062, totalTokens: 77211 });
    assert.ok(!JSON.stringify(row).includes('English findings'));
});
test('live: system/task_notification becomes the same row; one without a tool call is dropped', () => {
    const provider = new ClaudeSessionsProvider();
    const [row] = provider.normalizeMessage({
        type: 'system',
        subtype: 'task_notification',
        uuid: 'e1',
        task_id: 'a2d15558959adbbbc',
        tool_use_id: AGENT_CALL,
        status: 'failed',
        summary: 'failed',
        output_file: '/tmp/x',
        usage: { total_tokens: 10, tool_uses: 2, duration_ms: 3000 },
    }, 's1');
    assert.equal(row.kind, 'task_notification');
    assert.equal(row.toolId, AGENT_CALL);
    assert.equal(row.status, 'failed');
    assert.deepEqual(row.usage, { toolUses: 2, durationMs: 3000, totalTokens: 10 });
    assert.deepEqual(provider.normalizeMessage({ type: 'system', subtype: 'task_notification', task_id: 't', status: 'completed' }, 's1'), []);
});
test('live: the async-launch result keeps its toolUseResult (snake_case on the SDK stream)', () => {
    const provider = new ClaudeSessionsProvider();
    const [row] = provider.normalizeMessage({
        type: 'user',
        uuid: 'r1',
        origin: { kind: 'human' },
        tool_use_result: { isAsync: true, status: 'async_launched', resolvedModel: 'claude-haiku-5-5' },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: AGENT_CALL, content: 'Async agent launched' }] },
    }, 's1');
    assert.equal(row.kind, 'tool_result');
    assert.deepEqual(row.toolUseResult, { isAsync: true, status: 'async_launched', resolvedModel: 'claude-haiku-5-5' });
});
test('background tracker links a subagent task to the Agent call that started it', () => {
    const tracker = createBackgroundTaskTracker({ now: () => 1000 });
    tracker.apply({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: AGENT_CALL, task_type: 'local_agent', description: 'Разведка' });
    const list = tracker.apply({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1', task_type: 'local_agent', description: 'Разведка' }] });
    assert.deepEqual(list, [{ taskId: 't1', kind: 'agent', description: 'Разведка', startedAt: 1000, toolUseId: AGENT_CALL }]);
});
//# sourceMappingURL=claude-task-notification.test.js.map