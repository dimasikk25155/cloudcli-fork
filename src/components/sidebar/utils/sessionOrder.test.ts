import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app.js';
import type { SessionWithProvider } from '../types/types.js';

import {
  applyManualSessionOrder,
  buildRecentProjects,
  getAllSessions,
  preserveSessionCreatedAt,
} from './utils.js';

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

test('missing createdAt does not fall back to lastActivity, so cards stay put', () => {
  const project = projectWith([
    { id: 'a', createdAt: '', lastActivity: '2026-09-03T12:00:01Z' },
    { id: 'b', createdAt: '', lastActivity: '2026-09-03T12:00:02Z' },
  ]);

  assert.deepEqual(idsOf(getAllSessions(project)), ['a', 'b']);
});

test('preserveSessionCreatedAt freezes the first timestamp against later ticks', () => {
  const first = preserveSessionCreatedAt({
    id: 'a',
    lastActivity: '2026-09-03T10:00:00Z',
  } as SessionWithProvider);

  const later = preserveSessionCreatedAt({
    id: 'a',
    lastActivity: '2026-09-03T10:00:05Z',
  } as SessionWithProvider, first);

  assert.equal(later.createdAt, '2026-09-03T10:00:00Z');
  assert.equal(later.lastActivity, '2026-09-03T10:00:05Z');
});

test('a real createdAt from the server wins over a previously frozen fallback', () => {
  const frozen = preserveSessionCreatedAt({
    id: 'a',
    lastActivity: '2026-09-03T10:00:00Z',
  } as SessionWithProvider);

  const fromServer = preserveSessionCreatedAt({
    id: 'a',
    createdAt: '2026-08-01T09:00:00Z',
    lastActivity: '2026-09-03T10:00:05Z',
  } as SessionWithProvider, frozen);

  assert.equal(fromServer.createdAt, '2026-08-01T09:00:00Z');
});

test('recent journal folders do not swap when two sessions trade lastActivity', () => {
  const tyres = {
    projectId: 'tyres',
    displayName: 'Tyres KZ',
    fullPath: '/tyres',
    sessions: [
      { id: 't1', createdAt: '2026-08-01T10:00:00Z', lastActivity: '2026-09-03T12:00:01Z' },
      { id: 't2', createdAt: '2026-08-02T10:00:00Z', lastActivity: '2026-09-03T12:00:00Z' },
    ],
  } as unknown as Project;
  const agenda = {
    projectId: 'agenda',
    displayName: 'claude agent',
    fullPath: '/claude-agent',
    sessions: [
      { id: 'a1', createdAt: '2026-07-01T10:00:00Z', lastActivity: '2026-09-03T12:00:02Z' },
      { id: 'a2', createdAt: '2026-07-02T10:00:00Z', lastActivity: '2026-09-03T12:00:03Z' },
    ],
  } as unknown as Project;

  const nobodyHidden = {};
  const first = buildRecentProjects([tyres, agenda], nobodyHidden, {});

  const hotterAgenda = {
    ...agenda,
    sessions: (agenda.sessions ?? []).map((session, index) => (
      index === 0
        ? { ...session, lastActivity: '2026-09-03T12:00:10Z' }
        : session
    )),
  } as unknown as Project;
  const hotterTyres = {
    ...tyres,
    sessions: (tyres.sessions ?? []).map((session, index) => (
      index === 0
        ? { ...session, lastActivity: '2026-09-03T12:00:11Z' }
        : session
    )),
  } as unknown as Project;

  const afterAgendaTick = buildRecentProjects([hotterTyres, hotterAgenda], nobodyHidden, {});
  const afterTyresTick = buildRecentProjects([hotterTyres, hotterAgenda], nobodyHidden, {});

  assert.deepEqual(first.map((project) => project.projectId), ['tyres', 'agenda']);
  assert.deepEqual(afterAgendaTick.map((project) => project.projectId), ['tyres', 'agenda']);
  assert.deepEqual(afterTyresTick.map((project) => project.projectId), ['tyres', 'agenda']);
  assert.deepEqual(idsOf(getAllSessions(afterTyresTick[0])), ['t2', 't1']);
  assert.deepEqual(idsOf(getAllSessions(afterAgendaTick[1])), ['a2', 'a1']);
});

test('a hidden session is omitted from the Recent journal', () => {
  const tyres = {
    projectId: 'tyres',
    displayName: 'Tyres KZ',
    fullPath: '/tyres',
    sessions: [
      { id: 't1', createdAt: '2026-08-01T10:00:00Z', lastActivity: '2026-09-03T12:00:01Z' },
      { id: 't2', createdAt: '2026-08-02T10:00:00Z', lastActivity: '2026-09-03T12:00:00Z' },
    ],
  } as unknown as Project;

  const journal = buildRecentProjects([tyres], { t1: '2026-09-03T12:00:00Z' }, {});
  assert.equal(journal.length, 1);
  assert.deepEqual(idsOf(getAllSessions(journal[0])), ['t2']);
});
