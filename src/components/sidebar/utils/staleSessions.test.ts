import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../../types/app';

import { hideStaleSessions } from './utils.js';

const NOW = new Date('2026-11-14T16:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const projectWith = (sessions: Array<{ id: string; updated: string }>, hasMore = true): Project =>
  ({
    projectId: 'p1',
    displayName: 'p1',
    sessions: sessions.map(({ id, updated }) => ({ id, updated_at: updated, lastActivity: updated, createdAt: updated })),
    sessionMeta: { total: 99, hasMore },
  } as unknown as Project);

test('чаты старше 5 дней прячутся, свежие остаются', () => {
  const [project] = hideStaleSessions(
    [projectWith([{ id: 'fresh', updated: daysAgo(1) }, { id: 'old', updated: daysAgo(6) }])],
    NOW,
    new Set(),
  );
  assert.deepEqual(project.sessions?.map((session) => session.id), ['fresh']);
  assert.equal(project.sessionMeta?.hasMore, false, 'дальше по страницам только старые — «Load more» не нужен');
  assert.equal(project.sessionMeta?.total, 1);
});

test('работающий, открытый или закреплённый старый чат не прячется', () => {
  const [project] = hideStaleSessions(
    [projectWith([{ id: 'old', updated: daysAgo(30) }])],
    NOW,
    new Set(['old']),
  );
  assert.deepEqual(project.sessions?.map((session) => session.id), ['old']);
});

test('проект без свежих чатов остаётся в списке — из него начинают новый', () => {
  const result = hideStaleSessions([projectWith([{ id: 'old', updated: daysAgo(10) }])], NOW, new Set());
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sessions, []);
});

test('если прятать нечего, проект возвращается как был (и «Load more» не трогается)', () => {
  const original = projectWith([{ id: 'fresh', updated: daysAgo(4.9) }]);
  const [project] = hideStaleSessions([original], NOW, new Set());
  assert.equal(project, original);
});
