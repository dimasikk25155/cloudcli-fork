import assert from 'node:assert/strict';
import test from 'node:test';

import { createBackgroundTaskTracker } from '@/modules/background-tasks/index.js';

// Message shapes as declared in @anthropic-ai/claude-agent-sdk sdk.d.ts
// (SDKBackgroundTasksChangedMessage, SDKTaskStartedMessage,
// SDKTaskProgressMessage, SDKTaskNotificationMessage, SDKTaskUpdatedMessage).
const base = { type: 'system', uuid: '00000000-0000-0000-0000-000000000000', session_id: 'sess-1' } as const;

function clock(start: number) {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

test('background_tasks_changed sets the full list (replace semantics)', () => {
  const time = clock(1_000);
  const tracker = createBackgroundTaskTracker({ now: time.now });

  const first = tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'b1', task_type: 'local_bash', description: 'npm run dev' },
      { task_id: 'a1', task_type: 'local_agent', description: 'Review the diff' },
    ],
  });
  assert.deepEqual(first, [
    { taskId: 'b1', kind: 'bash', description: 'npm run dev', startedAt: 1_000 },
    { taskId: 'a1', kind: 'agent', description: 'Review the diff', startedAt: 1_000 },
  ]);

  time.advance(5_000);
  const second = tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'a1', task_type: 'local_agent', description: 'Review the diff' }],
  });
  // b1 left the set; a1 keeps the time it was first seen.
  assert.deepEqual(second, [
    { taskId: 'a1', kind: 'agent', description: 'Review the diff', startedAt: 1_000 },
  ]);
});

test('monitor tasks are reported as monitors', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 7 });
  const tasks = tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'm1', task_type: 'monitor', description: 'tail -f deploy.log' }],
  });
  assert.equal(tasks?.[0]?.kind, 'monitor');
});

test('task_started before the level keeps its start time; progress adds the last tool', () => {
  const time = clock(10_000);
  const tracker = createBackgroundTaskTracker({ now: time.now });

  // A start edge alone does not put a task in the background list.
  assert.equal(
    tracker.apply({ ...base, subtype: 'task_started', task_id: 'a2', description: 'Explore the repo', task_type: 'local_agent', subagent_type: 'Explore' }),
    null,
  );

  time.advance(2_000);
  const level = tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'a2', task_type: 'local_agent', description: 'Explore the repo' }],
  });
  assert.deepEqual(level, [
    { taskId: 'a2', kind: 'agent', description: 'Explore the repo', startedAt: 10_000 },
  ]);

  const progress = tracker.apply({
    ...base,
    subtype: 'task_progress',
    task_id: 'a2',
    description: 'Explore the repo',
    usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 4000 },
    last_tool_name: 'Grep',
  });
  assert.deepEqual(progress, [
    { taskId: 'a2', kind: 'agent', description: 'Explore the repo', startedAt: 10_000, lastTool: 'Grep' },
  ]);
});

test('progress of a task that is not in the background list changes nothing', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 0 });
  assert.equal(
    tracker.apply({
      ...base,
      subtype: 'task_progress',
      task_id: 'fg',
      description: 'foreground agent',
      usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
      last_tool_name: 'Read',
    }),
    null,
  );
});

test('task_notification and a terminal task_updated remove the finished task', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 0 });
  tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'b1', task_type: 'local_bash', description: 'sleep 100' },
      { task_id: 'b2', task_type: 'local_bash', description: 'npm run build' },
    ],
  });

  const afterNotification = tracker.apply({
    ...base,
    subtype: 'task_notification',
    task_id: 'b1',
    status: 'stopped',
    output_file: '/tmp/b1.out',
    summary: 'stopped',
  });
  assert.deepEqual(afterNotification?.map((task) => task.taskId), ['b2']);

  const afterUpdate = tracker.apply({
    ...base,
    subtype: 'task_updated',
    task_id: 'b2',
    patch: { status: 'completed', end_time: 5 },
  });
  assert.deepEqual(afterUpdate, []);
  assert.equal(tracker.has('b2'), false);
});

test('messages that are not background-task events are ignored', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 0 });
  assert.equal(tracker.apply({ ...base, subtype: 'session_state_changed', state: 'idle' }), null);
  assert.equal(tracker.apply({ type: 'assistant', message: { content: [] } }), null);
  assert.equal(tracker.apply(null), null);
  assert.deepEqual(tracker.list(), []);
});

test('has() reports whether a task is still running in the background', () => {
  const tracker = createBackgroundTaskTracker({ now: () => 0 });
  tracker.apply({
    ...base,
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'b9', task_type: 'local_bash', description: 'watch' }],
  });
  assert.equal(tracker.has('b9'), true);
  assert.equal(tracker.has('nope'), false);
});
