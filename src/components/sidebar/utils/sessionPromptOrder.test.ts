import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionWithProvider } from '../types/types';

import { getSessionPromptTime, isSessionSortOrder, sortSessionsByPrompt } from './utils';

const chat = (id: string, createdAt: string, lastPromptAt?: string | null, lastActivity?: string): SessionWithProvider =>
  ({ id, createdAt, lastPromptAt, lastActivity, __provider: 'claude' }) as SessionWithProvider;

test('«Недавние»: the chat Dima wrote in last goes first, agent activity does not count', () => {
  const sessions = [
    chat('old-but-busy-agent', '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z', '2026-11-23T10:00:00Z'),
    chat('newest', '2026-11-23T09:00:00Z', '2026-11-23T09:00:00Z'),
    chat('written-just-now', '2026-11-21T08:00:00Z', '2026-11-23T10:15:00Z'),
  ];
  assert.deepEqual(sortSessionsByPrompt(sessions).map((s) => s.id), ['written-just-now', 'newest', 'old-but-busy-agent']);
});

test('a chat never prompted from Neo3 is placed by its creation time', () => {
  const cli = chat('cli', '2026-11-22T12:00:00Z', null);
  assert.equal(getSessionPromptTime(cli), Date.parse('2026-11-22T12:00:00Z'));
  const broken = chat('broken', '2026-11-22T12:00:00Z', 'not a date');
  assert.equal(getSessionPromptTime(broken), Date.parse('2026-11-22T12:00:00Z'));
});

test('equal times keep a stable order and the input is not mutated', () => {
  const sessions = [chat('b', '2026-11-22T12:00:00Z'), chat('a', '2026-11-22T12:00:00Z')];
  assert.deepEqual(sortSessionsByPrompt(sessions).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(sessions.map((s) => s.id), ['b', 'a']);
});

test('only the two known orders are accepted from storage', () => {
  assert.equal(isSessionSortOrder('created'), true);
  assert.equal(isSessionSortOrder('prompt'), true);
  assert.equal(isSessionSortOrder('recent'), false);
});
