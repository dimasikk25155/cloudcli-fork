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

test('«Стоп» is the server\'s call: the frame\'s stoppable flag is kept, with the engine to name', () => {
  backgroundTasksStore.setTasks('s-grok', [task], { stoppable: false, provider: 'grok' });
  assert.equal(backgroundTasksStore.get('s-grok').stoppable, false);
  assert.equal(backgroundTasksStore.get('s-grok').provider, 'grok');
  // The flag decides, not the engine's name.
  backgroundTasksStore.setTasks('s-claude', [task], { stoppable: true, provider: 'claude' });
  assert.equal(backgroundTasksStore.get('s-claude').stoppable, true);
  backgroundTasksStore.setTasks('s-other', [task], { stoppable: true, provider: 'grok' });
  assert.equal(backgroundTasksStore.get('s-other').stoppable, true);
  backgroundTasksStore.setTasks('s-none', [task], {});
  assert.equal(backgroundTasksStore.get('s-none').stoppable, false);
  for (const id of ['s-grok', 's-claude', 's-other', 's-none']) backgroundTasksStore.clear(id);
});
