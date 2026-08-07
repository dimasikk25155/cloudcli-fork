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

test('subagent containers stay outside groups', () => {
  const items = groupConsecutiveTools([tool('Task', { isSubagentContainer: true }), tool('Bash')], true);
  assert.equal(items.length, 2);
  assert.equal(isToolGroupItem(items[0]), false);
  assert.equal(isToolGroupItem(items[1]), true);
});
