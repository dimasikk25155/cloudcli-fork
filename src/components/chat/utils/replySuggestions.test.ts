import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types.js';

import { lastAssistantReply, shouldShowReplyChips } from './replySuggestions.js';

const user = (content: string): ChatMessage => ({ type: 'user', timestamp: 1, content });
const reply = (content: string): ChatMessage => ({ type: 'assistant', timestamp: 1, content });
const tool = (): ChatMessage => ({ type: 'assistant', timestamp: 1, content: '', isToolUse: true, toolName: 'Bash' });

test('the chips belong to the last assistant reply, and only while nobody has written after it', () => {
  assert.equal(
    lastAssistantReply([user('Выкати'), tool(), reply('Выкатить сейчас?'), tool()]),
    'Выкатить сейчас?',
  );
  assert.equal(lastAssistantReply([reply('Выкатить сейчас?'), user('Да')]), null);
  assert.equal(lastAssistantReply([user('Привет')]), null);
  assert.equal(lastAssistantReply([]), null);
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
