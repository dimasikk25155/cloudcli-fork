// Regression tests for the collector that turns engine events into "the answer".
//
// It used to look for a legacy { type: 'claude-response', data: { type:
// 'assistant' } } shape that no engine emits any more, so every unattended run
// (schedule, pipeline step, Telegram reply) reported success with empty text
// and {{prev}} passed an empty string to the next step.

import assert from 'node:assert/strict';
import test from 'node:test';

import { RunCollector } from '@/modules/agent-run/agent-run.service.js';

function normalized(fields: Record<string, unknown>): string {
  return JSON.stringify({ id: 'm', sessionId: 's', timestamp: 't', provider: 'claude', ...fields });
}

test('collects assistant text from normalized messages', () => {
  const collector = new RunCollector();
  collector.send(normalized({ kind: 'session_created' }));
  collector.send(normalized({ kind: 'text', role: 'assistant', content: 'КАРБЮРАТОР' }));
  collector.send(normalized({ kind: 'complete' }));

  assert.equal(collector.getText(), 'КАРБЮРАТОР');
});

test('ignores tool traffic, status noise and the echoed user prompt', () => {
  const collector = new RunCollector();
  collector.send(normalized({ kind: 'text', role: 'user', content: 'что я спросил' }));
  collector.send(normalized({ kind: 'tool_use', toolName: 'Read', content: 'file.txt' }));
  collector.send(normalized({ kind: 'status', content: 'token_budget' }));
  collector.send(normalized({ kind: 'text', role: 'assistant', content: 'ответ' }));

  assert.equal(collector.getText(), 'ответ');
});

test('falls back to stream deltas for engines that only stream', () => {
  const collector = new RunCollector();
  collector.send(normalized({ kind: 'stream_delta', content: 'PO' }));
  collector.send(normalized({ kind: 'stream_delta', content: 'NG' }));

  assert.equal(collector.getText(), 'PONG');
});

test('does not count a streamed answer twice when a final text also arrives', () => {
  const collector = new RunCollector();
  collector.send(normalized({ kind: 'stream_delta', content: 'PO' }));
  collector.send(normalized({ kind: 'stream_delta', content: 'NG' }));
  collector.send(normalized({ kind: 'text', role: 'assistant', content: 'PONG' }));

  assert.equal(collector.getText(), 'PONG');
});

test('joins several assistant messages in order', () => {
  const collector = new RunCollector();
  collector.send(normalized({ kind: 'text', role: 'assistant', content: 'первая' }));
  collector.send(normalized({ kind: 'text', role: 'assistant', content: 'вторая' }));

  assert.equal(collector.getText(), 'первая\nвторая');
});

test('accepts objects as well as JSON strings', () => {
  const collector = new RunCollector();
  collector.send({ kind: 'text', role: 'assistant', content: 'объектом' });

  assert.equal(collector.getText(), 'объектом');
});
