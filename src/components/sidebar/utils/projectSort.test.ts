import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project, ProjectSession } from '../../../types/app.js';

import { sortProjects } from './projectSort.js';
import {
  PROJECT_SORT_CHANGED_EVENT,
  PROJECT_SORT_STORAGE_KEY,
  readProjectSortOrder,
  writeProjectSortOrder,
} from './utils.js';

const chat = (id: string, lastActivity: string, createdAt = '2026-01-01T00:00:00Z'): ProjectSession =>
  ({ id, lastActivity, createdAt } as unknown as ProjectSession);

const projectAt = (path: string, extras: Partial<Project> = {}): Project => ({
  projectId: extras.projectId ?? path,
  displayName: extras.displayName ?? path.split('/').pop() ?? path,
  fullPath: path,
  path,
  ...extras,
});

const root = '/Users/dimasik/Antigravity Project';
// Created long ago, talked to yesterday: the old «date» order used creation
// time and kept it at the bottom.
const tyres = projectAt(`${root}/Tyres`, {
  displayName: 'Tyres KZ',
  sessions: [chat('t1', '2026-11-22T20:00:00Z', '2026-09-01T00:00:00Z')],
});
// Newest chat created recently, but silent since.
const mazda = projectAt(`${root}/mazda`, {
  displayName: 'mazda',
  sessions: [chat('m1', '2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z')],
});
const buh = projectAt(`${root}/buh-bot`, { displayName: 'Бух-бот', sessions: [chat('b1', '2026-11-20T10:00:00Z')] });
const alpha = projectAt(`${root}/alpha`, { displayName: 'alpha' });
const zeta = projectAt(`${root}/zeta`, { displayName: 'zeta' });
const pinnedOld = projectAt(`${root}/claude agent`, {
  displayName: 'claude agent',
  isStarred: true,
  sessions: [chat('c1', '2026-10-01T00:00:00Z')],
});
const pinnedFresh = projectAt(`${root}/sport-bet`, {
  displayName: 'sport-bet',
  isStarred: true,
  sessions: [chat('s1', '2026-11-23T00:00:00Z')],
});
const codexFresh = projectAt('/Users/dimasik/Documents/Codex/2026-11-23/new-chat', {
  displayName: 'new-chat',
  sessions: [chat('x1', '2026-11-23T01:00:00Z')],
});

const names = (list: Project[]) => list.map((project) => project.displayName);

test("'recent': pinned first, then by last chat activity, Codex inbox below, no chats by name", () => {
  const sorted = sortProjects([zeta, alpha, codexFresh, mazda, pinnedOld, buh, tyres, pinnedFresh], 'recent');
  assert.deepEqual(names(sorted), [
    'sport-bet',
    'claude agent',
    'Tyres KZ',
    'Бух-бот',
    'mazda',
    'alpha',
    'zeta',
    'new-chat',
  ]);
});

// Russian collation, as on Dima's devices: Cyrillic before Latin.
test("'name': pinned first, then alphabetical, Codex inbox below", () => {
  const sorted = sortProjects([zeta, codexFresh, mazda, pinnedFresh, buh, tyres, pinnedOld, alpha], 'name');
  assert.deepEqual(names(sorted), [
    'claude agent',
    'sport-bet',
    'Бух-бот',
    'alpha',
    'mazda',
    'Tyres KZ',
    'zeta',
    'new-chat',
  ]);
});

function withBrowserStorage(run: (events: string[]) => void) {
  const store = new Map<string, string>();
  const target = new EventTarget();
  const events: string[] = [];
  target.addEventListener(PROJECT_SORT_CHANGED_EVENT, (event) => {
    events.push(String((event as CustomEvent).detail));
  });
  const globals = globalThis as Record<string, unknown>;
  const saved = { localStorage: globals.localStorage, window: globals.window };
  globals.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  globals.window = target;
  try {
    run(events);
  } finally {
    globals.localStorage = saved.localStorage;
    globals.window = saved.window;
  }
}

test('sort order: «recent» by default, the old claude-settings choice is ignored', () => {
  withBrowserStorage(() => {
    assert.equal(readProjectSortOrder(), 'recent');
    localStorage.setItem('claude-settings', JSON.stringify({ projectSortOrder: 'name' }));
    assert.equal(readProjectSortOrder(), 'recent');
    localStorage.setItem(PROJECT_SORT_STORAGE_KEY, 'garbage');
    assert.equal(readProjectSortOrder(), 'recent');
  });
});

test('sort order: write stores neo3-project-sort and tells this tab', () => {
  withBrowserStorage((events) => {
    writeProjectSortOrder('name');
    assert.equal(localStorage.getItem('neo3-project-sort'), 'name');
    assert.equal(readProjectSortOrder(), 'name');
    assert.deepEqual(events, ['name']);
    writeProjectSortOrder('recent');
    assert.equal(readProjectSortOrder(), 'recent');
    assert.deepEqual(events, ['name', 'recent']);
  });
});
