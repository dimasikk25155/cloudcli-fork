import assert from 'node:assert/strict';
import test from 'node:test';

import { groupConsecutiveTools, isToolGroupItem } from './toolGrouping.js';

const text = (content: string) => ({ type: 'assistant', timestamp: 1, content }) as any;
const tool = (toolName: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'assistant', timestamp: 1, content: '', isToolUse: true, toolName, ...extra }) as any;

test('a lone tool call still collapses into a group', () => {
  const [item] = groupConsecutiveTools([tool('Read')], true);
  assert.equal(isToolGroupItem(item), true);
  assert.equal(isToolGroupItem(item) && item.messages.length, 1);
});

test('a run of different tools collapses into one mixed group', () => {
  const items = groupConsecutiveTools([tool('Write'), tool('Bash'), tool('Read')], true);
  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]) && items[0].isMixed, true);
  assert.equal(isToolGroupItem(items[0]) && items[0].toolName, '');
});

test('a run of one tool keeps its name and is not mixed', () => {
  const items = groupConsecutiveTools([tool('Bash'), tool('Bash')], true);
  assert.equal(isToolGroupItem(items[0]) && items[0].isMixed, false);
  assert.equal(isToolGroupItem(items[0]) && items[0].toolName, 'Bash');
});

test('text between tool calls splits the run into separate groups', () => {
  const items = groupConsecutiveTools([tool('Bash'), text('hi'), tool('Read')], true);
  assert.equal(items.length, 3);
  assert.equal(isToolGroupItem(items[0]), true);
  assert.equal(isToolGroupItem(items[1]), false);
  assert.equal(isToolGroupItem(items[2]), true);
});

test('hidden reasoning does not break a run', () => {
  const items = groupConsecutiveTools(
    [tool('Bash'), { type: 'assistant', timestamp: 1, content: '...', isThinking: true } as any, tool('Read')],
    false,
  );
  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]) && items[0].messages.length, 2);
});

test('the plan stays outside groups and splits the run', () => {
  for (const name of ['ExitPlanMode', 'exit_plan_mode']) {
    const items = groupConsecutiveTools([tool('Bash'), tool(name), tool('Read')], true);
    assert.equal(items.length, 3);
    assert.equal(isToolGroupItem(items[0]), true);
    assert.equal(isToolGroupItem(items[1]), false);
    assert.equal(isToolGroupItem(items[2]), true);
  }
});

test('subagent containers stay outside groups', () => {
  const items = groupConsecutiveTools([tool('Task', { isSubagentContainer: true }), tool('Bash')], true);
  assert.equal(items.length, 2);
  assert.equal(isToolGroupItem(items[0]), false);
  assert.equal(isToolGroupItem(items[1]), true);
});

const step = (content: string, taskStatus = 'completed') =>
  ({ type: 'assistant', timestamp: 1, content, isTaskNotification: true, taskStatus }) as any;

test('two or more step notifications in a row fold into one collapsed group', () => {
  const items = groupConsecutiveTools([step('Fetch status'), step('Diff pages'), step('Hash assets')], true);
  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]) && items[0].isTaskNotifications, true);
  assert.equal(isToolGroupItem(items[0]) && items[0].messages.length, 3);
});

test('a single step notification stays visible on its own', () => {
  const items = groupConsecutiveTools([text('hi'), step('Background command done'), text('ok')], true);
  assert.equal(items.length, 3);
  assert.equal(isToolGroupItem(items[1]), false);
});

test('step notifications and tool calls form separate groups', () => {
  const items = groupConsecutiveTools([tool('Bash'), step('a'), step('b'), tool('Read')], true);
  assert.equal(items.length, 3);
  assert.equal(isToolGroupItem(items[0]) && !items[0].isTaskNotifications, true);
  assert.equal(isToolGroupItem(items[1]) && items[1].isTaskNotifications, true);
  assert.equal(isToolGroupItem(items[2]) && !items[2].isTaskNotifications, true);
});

test('hidden reasoning between steps does not split the run', () => {
  const thinking = { type: 'assistant', timestamp: 1, content: 'x', isThinking: true } as any;
  const items = groupConsecutiveTools([step('a'), thinking, step('b')], false);
  assert.equal(items.length, 1);
  assert.equal(isToolGroupItem(items[0]) && items[0].messages.length, 2);
});

test('mixed runs of tools, text and steps keep ordinary tool groups intact', () => {
  const items = groupConsecutiveTools(
    [tool('Read'), tool('Read'), step('a'), text('hi'), tool('Bash'), step('b'), step('c'), step('d')],
    true,
  );
  assert.equal(items.length, 5);
  assert.equal(isToolGroupItem(items[0]) && items[0].toolName === 'Read' && items[0].messages.length === 2, true);
  assert.equal(isToolGroupItem(items[1]), false);
  assert.equal(isToolGroupItem(items[2]), false);
  assert.equal(isToolGroupItem(items[3]) && items[3].toolName === 'Bash' && !items[3].isTaskNotifications, true);
  assert.equal(isToolGroupItem(items[4]) && items[4].isTaskNotifications && items[4].messages.length === 3, true);
});
