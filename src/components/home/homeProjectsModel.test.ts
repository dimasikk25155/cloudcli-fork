import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../types/app.js';

import {
  HOME_RECENT_LIMIT,
  HOME_RECENT_MAX_AGE_MS,
  buildHomeProjects,
  isHomeJunkProject,
  projectRecency,
} from './homeProjectsModel.js';
import { REAL_PROJECTS } from './realProjects.fixture.js';

const NOW = Date.parse('2026-11-22T20:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const projectAt = (path: string, extras: Partial<Project> = {}): Project => ({
  projectId: extras.projectId ?? path,
  displayName: extras.displayName ?? path.split('/').pop() ?? path,
  fullPath: path,
  path,
  ...extras,
});

/** A project whose newest chat was active `daysAgo` days before NOW. */
const activeAt = (name: string, daysAgo: number | null, extras: Partial<Project> = {}): Project =>
  projectAt(`/Users/dimasik/Antigravity Project/${name}`, {
    displayName: name,
    sessions: daysAgo === null
      ? []
      : [
          { id: `${name}-old`, createdAt: new Date(NOW - (daysAgo + 30) * DAY).toISOString() },
          { id: `${name}-new`, lastActivity: new Date(NOW - daysAgo * DAY).toISOString() },
        ],
    ...extras,
  });

const names = (projects: Project[]) => projects.map((project) => project.displayName);

// Пути из полного списка 22.11, которые на «Домой» не должны попадать.
const JUNK_PATHS = [
  '/Users/dimasik/Antigravity Project/Tyres-7su/tmp/pirelli-iz2-235-45-r18-dot1226/gen',
  '/Users/dimasik/Antigravity Project/Tyres-7su/tmp/goodyear-ugice2-185-65-r15',
  '/Users/dimasik/Antigravity Project/Tyres/outputs/home-bg-2026-11-04',
  '/Users/dimasik/Antigravity Project/Tyres/outputs/home-bg-dark-2026-11-04',
  '/var/folders/k5/3sy50krn03s3s0f_qgplfn5h0000gn/T/neo3-effort-live-rz75Mz',
  '/private/var/folders/k5/x/T/neo3-check',
  '/private/var/tmp/run',
  '/tmp',
  '/tmp/agent-probe',
  '/private/tmp/neo3-x',
  '/Users/dimasik/Antigravity Project/claude agent/tmp-relay-repro',
  '/Users/dimasik/.cloudcli/maintenance/vps-fi-return-20261118',
  '/Users/dimasik/.local/share/cashback-relay/work',
  '/Users/dimasik/Antigravity Project/claude agent/.repro-tmp3/x',
  '/Users/dimasik/Documents/Codex/2026-09-11/new-chat',
  '/Users/dimasik/Documents/ChatGPT/Samruk Шина',
];

const REAL_KEEP_PATHS = [
  '/Users/dimasik',
  '/Users/dimasik/Antigravity Project',
  '/Users/dimasik/Antigravity Project/Tyres',
  '/Users/dimasik/Antigravity Project/claude agent',
  '/Users/dimasik/Antigravity Project/claude agent/cloudcli-fork',
  '/Users/dimasik/Antigravity Project/sport-bet',
  '/Users/dimasik/Antigravity Project/sport-bet/research/premium-channel',
  '/Users/dimasik/Antigravity Project/Tyres-7su/elki',
  '/Users/dimasik/Antigravity Project/Tyres/tyres-kz-team',
  '/Users/dimasik/Antigravity Project/Dimasik-Obsidian/Dimasik/Neo3-VPN',
  '/Users/dimasik/Antigravity Project/tiktok ads',
  '/Users/dimasik/Antigravity Project/sharmax.com',
];

test('junk folders never reach Home', () => {
  for (const path of JUNK_PATHS) {
    assert.equal(isHomeJunkProject(projectAt(path)), true, path);
  }
});

test('real workspaces are not junk', () => {
  for (const path of REAL_KEEP_PATHS) {
    assert.equal(isHomeJunkProject(projectAt(path)), false, path);
  }
});

test('the live 22.11 list loses exactly its ten junk folders', () => {
  const junk = REAL_PROJECTS
    .filter(([name, path]) => isHomeJunkProject(projectAt(path, { displayName: name })))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(junk, [
    'gen',
    'goodyear-ugice2-185-65-r15',
    'home-bg-2026-11-04',
    'home-bg-dark-2026-11-04',
    'michelin-latitude-xi2-275-65-r17',
    'neo3-effort-live-rz75Mz',
    'tmp-relay-repro',
    'triangle-trs06-315-70-r22.5-dot1726',
    'vps-fi-return-20261118',
    'work',
  ].sort());
});

test('recency is the newest chat activity, 0 without chats', () => {
  assert.equal(projectRecency(activeAt('a', 3)), NOW - 3 * DAY);
  assert.equal(projectRecency(activeAt('b', null)), 0);
  assert.equal(projectRecency(projectAt('/x')), 0);
});

test('pinned first, then recent; both by latest activity, ties by name', () => {
  const projects = [
    activeAt('Бета', 5),
    activeAt('Альфа', 5),
    activeAt('Старый закреп', 40, { isStarred: true }),
    activeAt('Свежий закреп', 1, { isStarred: true }),
    activeAt('Вчера', 1),
    activeAt('Без чатов закреп', null, { isStarred: true }),
  ];
  const { items, hiddenCount } = buildHomeProjects(projects, { now: NOW, query: '', showAll: false });
  assert.deepEqual(names(items), [
    'Свежий закреп',
    'Старый закреп',
    'Без чатов закреп',
    'Вчера',
    'Альфа',
    'Бета',
  ]);
  assert.equal(hiddenCount, 0);
});

test('at most 12 recent projects, only those active within 14 days', () => {
  const recent = Array.from({ length: 15 }, (_, index) => activeAt(`p${String(index).padStart(2, '0')}`, index * 0.5));
  const stale = [activeAt('месяц назад', 30), activeAt('без чатов', null)];
  const { items, hiddenCount } = buildHomeProjects([...stale, ...recent], { now: NOW, query: '', showAll: false });
  assert.equal(HOME_RECENT_LIMIT, 12);
  assert.equal(HOME_RECENT_MAX_AGE_MS, 14 * DAY);
  assert.deepEqual(names(items), recent.slice(0, 12).map((project) => project.displayName));
  // 3 recent beyond the limit + 2 stale ones.
  assert.equal(hiddenCount, 5);
});

test('a chat exactly 14 days old still counts, a day older does not', () => {
  const { items } = buildHomeProjects(
    [activeAt('ровно 14', 14), activeAt('15 дней', 15)],
    { now: NOW, query: '', showAll: false },
  );
  assert.deepEqual(names(items), ['ровно 14']);
});

test('junk is never shown or counted, unless it is pinned', () => {
  const junk = projectAt('/Users/dimasik/Documents/Codex/2026-11-20/chat', {
    displayName: 'Codex чат',
    sessions: [{ id: 'c', lastActivity: new Date(NOW - DAY).toISOString() }],
  });
  const pinnedJunk = projectAt('/tmp/pinned', {
    displayName: 'tmp закреп',
    isStarred: true,
    sessions: [{ id: 't', lastActivity: new Date(NOW - DAY).toISOString() }],
  });
  const real = activeAt('Tyres', 2);

  const collapsed = buildHomeProjects([junk, pinnedJunk, real], { now: NOW, query: '', showAll: false });
  assert.deepEqual(names(collapsed.items), ['tmp закреп', 'Tyres']);
  assert.equal(collapsed.hiddenCount, 0);

  const all = buildHomeProjects([junk, pinnedJunk, real], { now: NOW, query: '', showAll: true });
  assert.deepEqual(names(all.items), ['tmp закреп', 'Tyres']);

  const found = buildHomeProjects([junk, pinnedJunk, real], { now: NOW, query: 'чат', showAll: false });
  assert.deepEqual(names(found.items), []);
});

test('show all lists every non-junk project, pinned first, nothing hidden', () => {
  const projects = [
    activeAt('старый', 60),
    activeAt('закреп', 90, { isStarred: true }),
    activeAt('без чатов', null),
    activeAt('вчера', 1),
    projectAt('/private/tmp/x', { displayName: 'x' }),
  ];
  const { items, hiddenCount } = buildHomeProjects(projects, { now: NOW, query: '', showAll: true });
  assert.deepEqual(names(items), ['закреп', 'вчера', 'старый', 'без чатов']);
  assert.equal(hiddenCount, 0);
});

test('search covers all non-junk projects by name or path, case-insensitive, no limit', () => {
  const many = Array.from({ length: 20 }, (_, index) => activeAt(`tyres-${index}`, 100 + index));
  const projects = [
    ...many,
    activeAt('Линии Сергея', 50, { fullPath: '/Users/dimasik/Antigravity Project/Tyres-sergey-lines' }),
    activeAt('mazda', 1, { isStarred: true }),
    projectAt('/Users/dimasik/Antigravity Project/Tyres/outputs/home-bg', { displayName: 'tyres outputs' }),
  ];
  const { items, hiddenCount } = buildHomeProjects(projects, { now: NOW, query: '  TYRES ', showAll: false });
  assert.equal(items.length, 21);
  assert.equal(items[0].displayName, 'Линии Сергея');
  assert.ok(!names(items).includes('tyres outputs'));
  assert.equal(hiddenCount, 0);

  const pinned = buildHomeProjects(projects, { now: NOW, query: 'MAZ', showAll: false });
  assert.deepEqual(names(pinned.items), ['mazda']);
});

test('the real 22.11 list: no junk on Home, all of it behind "All projects"', () => {
  const projects = REAL_PROJECTS.map(([name, path], index) =>
    projectAt(path, {
      projectId: `p${index}`,
      displayName: name,
      sessions: [{ id: `s${index}`, lastActivity: new Date(NOW - (index % 20) * DAY).toISOString() }],
    }));
  const collapsed = buildHomeProjects(projects, { now: NOW, query: '', showAll: false });
  assert.equal(collapsed.items.length, HOME_RECENT_LIMIT);
  assert.ok(collapsed.items.every((project) => !isHomeJunkProject(project)));

  const all = buildHomeProjects(projects, { now: NOW, query: '', showAll: true });
  assert.equal(all.items.length, REAL_PROJECTS.length - 10);
  assert.equal(collapsed.hiddenCount, all.items.length - HOME_RECENT_LIMIT);
});
