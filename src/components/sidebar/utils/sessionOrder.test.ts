import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app.js';
import type { SessionWithProvider } from '../types/types.js';

import { applyManualSessionOrder, getAllSessions } from './utils.js';

type SessionFixture = {
  id: string;
  createdAt: string;
  lastActivity?: string;
};

const projectWith = (sessions: SessionFixture[]): Project => ({
  sessions,
} as unknown as Project);

const idsOf = (sessions: SessionWithProvider[]): string[] => sessions.map((session) => String(session.id));

test('default order follows creation time, not activity', () => {
  // "b" is the busiest session; sorting by activity used to lift it to the top
  // mid-conversation, which is exactly the jumping the pinned order removes.
  const project = projectWith([
    { id: 'a', createdAt: '2026-08-01T10:00:00Z', lastActivity: '2026-08-01T10:00:00Z' },
    { id: 'b', createdAt: '2026-07-01T10:00:00Z', lastActivity: '2026-08-06T12:00:00Z' },
    { id: 'c', createdAt: '2026-08-03T10:00:00Z', lastActivity: '2026-08-03T10:00:00Z' },
  ]);

  assert.deepEqual(idsOf(getAllSessions(project)), ['c', 'a', 'b']);
});

test('sessions created at the same moment keep a stable order', () => {
  const project = projectWith([
    { id: 'z', createdAt: '2026-08-01T10:00:00Z' },
    { id: 'a', createdAt: '2026-08-01T10:00:00Z' },
  ]);

  assert.deepEqual(idsOf(getAllSessions(project)), ['a', 'z']);
});

test('a dragged arrangement wins over creation time', () => {
  const sessions = getAllSessions(projectWith([
    { id: 'a', createdAt: '2026-08-03T10:00:00Z' },
    { id: 'b', createdAt: '2026-08-02T10:00:00Z' },
    { id: 'c', createdAt: '2026-08-01T10:00:00Z' },
  ]));

  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, ['c', 'a', 'b'])), ['c', 'a', 'b']);
});

test('a brand-new session takes the top slot above the pinned ones', () => {
  const sessions = getAllSessions(projectWith([
    { id: 'fresh', createdAt: '2026-08-06T12:00:00Z' },
    { id: 'a', createdAt: '2026-08-03T10:00:00Z' },
    { id: 'b', createdAt: '2026-08-02T10:00:00Z' },
  ]));

  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, ['b', 'a'])), ['fresh', 'b', 'a']);
});

test('older sessions pulled in by "load more" land at the tail', () => {
  const sessions = getAllSessions(projectWith([
    { id: 'a', createdAt: '2026-08-03T10:00:00Z' },
    { id: 'b', createdAt: '2026-08-02T10:00:00Z' },
    { id: 'ancient', createdAt: '2026-01-01T10:00:00Z' },
  ]));

  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, ['b', 'a'])), ['b', 'a', 'ancient']);
});

test('an empty arrangement leaves the default order untouched', () => {
  const sessions = getAllSessions(projectWith([
    { id: 'a', createdAt: '2026-08-03T10:00:00Z' },
    { id: 'b', createdAt: '2026-08-02T10:00:00Z' },
  ]));

  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, [])), ['a', 'b']);
  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, undefined)), ['a', 'b']);
});

test('stale ids in the arrangement (deleted sessions) do not break it', () => {
  const sessions = getAllSessions(projectWith([
    { id: 'a', createdAt: '2026-08-03T10:00:00Z' },
    { id: 'b', createdAt: '2026-08-02T10:00:00Z' },
  ]));

  assert.deepEqual(idsOf(applyManualSessionOrder(sessions, ['gone', 'b', 'a'])), ['b', 'a']);
});
