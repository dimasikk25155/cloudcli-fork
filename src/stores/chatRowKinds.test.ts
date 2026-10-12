import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAT_ROW_KINDS } from './chatRowKinds.js';

// «Пульт фона» frames ride the chat socket with a sessionId but are status,
// not conversation: stored as rows they would have no id and blank the
// transcript on the next history merge (the 12.10 «Ждут тебя» bug).
test('background-task frames never become chat rows', () => {
  assert.equal(CHAT_ROW_KINDS.has('background_tasks'), false);
  assert.equal(CHAT_ROW_KINDS.has('background_task_stop'), false);
});

test('ordinary conversation kinds still do', () => {
  for (const kind of ['text', 'tool_use', 'tool_result', 'task_notification']) {
    assert.equal(CHAT_ROW_KINDS.has(kind), true, kind);
  }
});
