import assert from 'node:assert/strict';
import test from 'node:test';

import { getIntrinsicMessageKey } from './messageKeys.js';
import type { ChatMessage } from '../types/types.js';

test('follow-up Grok user bubbles keep the same key when history restamps now()', () => {
  const local: ChatMessage = {
    type: 'user',
    id: 'local_123_abc',
    content: 'вот что есть когда создаешь компанию на лид и продажи',
    timestamp: '2026-09-04T18:13:00.000Z',
  };
  const fromHistory: ChatMessage = {
    type: 'user',
    id: 'grok_c616ca26-de51-4b62-b99d-bf3924a58f7a',
    content: 'вот что есть когда создаешь компанию на лид и продажи',
    timestamp: '2026-09-04T18:30:01.309Z',
  };

  assert.equal(getIntrinsicMessageKey(local), getIntrinsicMessageKey(fromHistory));
  assert.notEqual(
    getIntrinsicMessageKey(fromHistory),
    getIntrinsicMessageKey({
      type: 'user',
      id: 'grok_1a70299a-a773-424c-8564-17ca708fe7cd',
      content: 'давай попробуем запустить рекламу теперь на сайт',
      timestamp: '2026-09-04T18:30:01.309Z',
    }),
  );
});
