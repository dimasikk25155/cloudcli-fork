import assert from 'node:assert/strict';
import test from 'node:test';

import { replyFingerprint } from '../../../../shared/reply-fingerprint.js';
import { lastReplyTurn } from '../../../../shared/reply-turn.js';

import { replyForChips, requestReplySuggestions, shouldShowReplyChips } from './replySuggestions.js';

// One normalized session (what the client store and the server transcript both
// hold): a reply in several text blocks with tool calls between them.
const LAST_BLOCK = 'Всё собрал. Выкатывать на прод или сначала на превью?';
const SESSION = [
  { kind: 'text', role: 'user', content: 'Собери лендинг.' },
  { kind: 'text', role: 'assistant', content: 'Начинаю: ставлю зависимости.' },
  { kind: 'tool_use', toolName: 'Bash' },
  { kind: 'tool_result', content: 'ok' },
  { kind: 'text', role: 'assistant', content: 'Сборка прошла, гоняю Lighthouse.' },
  { kind: 'tool_use', toolName: 'Bash' },
  { kind: 'text', role: 'assistant', content: `  ${LAST_BLOCK}\n` },
  { kind: 'text', role: 'user', content: 'Stop hook feedback: запиши итог в вольт' },
];

test('client and server pick the same reply from one session, so their fingerprints agree', () => {
  const clientReply = replyForChips(SESSION);
  const serverTurn = lastReplyTurn(SESSION);

  assert.equal(clientReply, LAST_BLOCK);
  assert.equal(serverTurn?.assistant, LAST_BLOCK);
  assert.equal(serverTurn?.user, 'Собери лендинг.');
  assert.equal(replyFingerprint(clientReply!), replyFingerprint(serverTurn!.assistant));
});

test('no chips once the user has written after the reply', () => {
  assert.equal(replyForChips([...SESSION, { kind: 'text', role: 'user', content: 'На прод' }]), null);
  assert.equal(replyForChips([{ kind: 'text', role: 'user', content: 'Привет' }]), null);
  assert.equal(replyForChips([]), null);
});

test('a stale answer is retried a few times with a pause, then given up without chips', async () => {
  const answers = [{ suggestions: [], stale: true }, { suggestions: [], stale: true }, { suggestions: ['Да', 'Нет'] }];
  const pauses: number[] = [];
  let calls = 0;
  const caughtUp = await requestReplySuggestions(async () => answers[calls++], {
    attempts: 3,
    delayMs: 1200,
    sleep: async (ms) => { pauses.push(ms); },
  });
  assert.deepEqual(caughtUp, { suggestions: ['Да', 'Нет'], stale: false });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [1200, 1200]);

  let staleCalls = 0;
  const neverCaughtUp = await requestReplySuggestions(async () => {
    staleCalls += 1;
    return { suggestions: [], stale: true };
  }, { attempts: 3, delayMs: 10, sleep: async () => {} });
  assert.deepEqual(neverCaughtUp, { suggestions: [], stale: true });
  assert.equal(staleCalls, 3);
});

test('chips show only on an idle, empty composer with no question, permission or queued message', () => {
  const idle = {
    suggestions: ['Да', 'Нет'],
    input: '',
    isLoading: false,
    hasPendingPermission: false,
    hasQueuedDraft: false,
  };
  assert.equal(shouldShowReplyChips(idle), true);

  assert.equal(shouldShowReplyChips({ ...idle, suggestions: [] }), false, 'model gave nothing');
  assert.equal(shouldShowReplyChips({ ...idle, suggestions: ['Да'] }), false, 'one chip is not a choice (2–3)');
  assert.equal(shouldShowReplyChips({ ...idle, input: 'п' }), false, 'started typing');
  assert.equal(shouldShowReplyChips({ ...idle, input: '   ' }), true, 'whitespace is not typing');
  assert.equal(shouldShowReplyChips({ ...idle, isLoading: true }), false, 'new turn running');
  assert.equal(shouldShowReplyChips({ ...idle, hasPendingPermission: true }), false, 'question/permission panel open');
  assert.equal(shouldShowReplyChips({ ...idle, hasQueuedDraft: true }), false, 'queued message waiting');
});
