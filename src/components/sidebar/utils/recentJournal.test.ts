import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionWithProvider } from '../types/types.js';

import { isSessionVisibleInRecentJournal } from './utils.js';

const sessionWith = (id: string, lastActivity: string): SessionWithProvider =>
  ({ id, lastActivity } as unknown as SessionWithProvider);

test('a hidden session stays hidden when its transcript gets touched later', () => {
  // The regression: an idle CLI process keeps bumping the mtime of its JSONL
  // file, so the old "hidden until newer activity" rule brought every hidden
  // card back on the next page load.
  const hidden = { a: '2026-08-11T18:00:00Z' };
  const session = sessionWith('a', '2026-08-11T21:30:00Z');

  assert.equal(isSessionVisibleInRecentJournal(session, hidden), false);
});

test('a session that was never hidden is listed', () => {
  const session = sessionWith('b', '2026-08-11T21:30:00Z');

  assert.equal(isSessionVisibleInRecentJournal(session, { a: '2026-08-11T18:00:00Z' }), true);
});

test('a hidden session stays hidden even while a CLI process is still running', () => {
  // A finished chat often leaves `claude`/`grok` alive, so "running" used to
  // un-hide the card the user just dismissed with ✕.
  const hidden = { a: '2026-08-11T18:00:00Z' };
  const session = sessionWith('a', '2026-08-11T18:00:00Z');

  assert.equal(isSessionVisibleInRecentJournal(session, hidden), false);
});

test('un-hiding puts the card back', () => {
  const session = sessionWith('a', '2026-08-11T18:00:00Z');

  assert.equal(isSessionVisibleInRecentJournal(session, {}), true);
});
