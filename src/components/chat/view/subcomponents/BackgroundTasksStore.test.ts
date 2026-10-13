import assert from 'node:assert/strict';
import test from 'node:test';

import { backgroundTasksStore, stopStateLabel } from './BackgroundTasksStore.js';

const task = { taskId: 'b1', kind: 'bash', description: 'sleep 120', startedAt: 1_000 };

test('«Стоп» after the turn ended says so honestly, not «Не остановилась»', () => {
  backgroundTasksStore.setTasks('s-ended', [task]);
  backgroundTasksStore.recordStopResult('s-ended', 'b1', false, 'turn_ended');

  const state = backgroundTasksStore.get('s-ended').stops.b1;
  assert.equal(stopStateLabel(state), 'Ход уже закончился — задача больше не управляется отсюда');
  backgroundTasksStore.clear('s-ended');
});

test('a task that is gone mid-turn and a failed stop keep their own answers', () => {
  backgroundTasksStore.setTasks('s-mid', [task, { ...task, taskId: 'b2' }]);
  backgroundTasksStore.recordStopResult('s-mid', 'b1', false, 'not_running');
  backgroundTasksStore.recordStopResult('s-mid', 'b2', false, 'failed');

  const { stops } = backgroundTasksStore.get('s-mid');
  assert.equal(stopStateLabel(stops.b1), 'Задача уже не идёт');
  assert.equal(stopStateLabel(stops.b2), 'Не остановилась');
  backgroundTasksStore.clear('s-mid');
});
