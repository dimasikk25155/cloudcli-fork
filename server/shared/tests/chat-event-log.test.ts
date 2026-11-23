import assert from 'node:assert/strict';
import test from 'node:test';

import { formatChatEvent, logChatEvent, setChatEventWriter } from '@/shared/chat-event-log.js';

const AT = new Date('2026-11-23T16:49:25.123Z');

test('one line per event: ISO time, event name, chat id and user id, then numbers and flags', () => {
  assert.equal(
    formatChatEvent('queue_send', { sessionId: 'chat-1', userId: 7, images: 2, sendNow: true }, AT),
    '[chat] 2026-11-23T16:49:25.123Z queue_send session=chat-1 user=7 images=2 sendNow=true',
  );
  // No user (a run nobody is signed in for) is said out loud, not skipped.
  assert.equal(
    formatChatEvent('run_complete', { sessionId: 'chat-1', userId: null, exitCode: 0, aborted: false }, AT),
    '[chat] 2026-11-23T16:49:25.123Z run_complete session=chat-1 user=- exitCode=0 aborted=false',
  );
});

test('short machine words pass (reason, access kind); anything that looks like a message does not', () => {
  const line = formatChatEvent('queue_hold', {
    sessionId: 'chat-1',
    userId: 7,
    reason: 'question',
    // A caller's mistake: message text and a token handed in as fields.
    content: 'Привет, вот мой пароль от сервера',
    token: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    skipped: undefined,
    nothing: null,
  }, AT);
  assert.equal(line, '[chat] 2026-11-23T16:49:25.123Z queue_hold session=chat-1 user=7 reason=question');
  assert.doesNotMatch(line, /Привет|пароль|sk-ant/);
});

test('a chat id with spaces or line breaks cannot forge a second line', () => {
  const line = formatChatEvent('subscribe', { sessionId: 'chat-1\n[chat] fake send session=x', userId: '7 admin' }, AT);
  assert.equal(line.includes('\n'), false);
  assert.equal(line.split(' ').filter((part) => part.startsWith('session=')).length, 1);
  assert.match(line, /^\[chat\] 2026-11-23T16:49:25\.123Z subscribe session=\S+ user=\S+$/);
});

test('logChatEvent writes the formatted line with the current time and never throws', () => {
  const lines: string[] = [];
  const restore = setChatEventWriter((line) => { lines.push(line); });
  try {
    logChatEvent('send', { sessionId: 'chat-2', userId: 3, started: true });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[chat\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z send session=chat-2 user=3 started=true$/);

    setChatEventWriter(() => { throw new Error('disk full'); });
    assert.doesNotThrow(() => logChatEvent('abort', { sessionId: 'chat-2' }));
  } finally {
    restore();
    setChatEventWriter(null);
  }
});
