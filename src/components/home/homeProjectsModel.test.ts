import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../types/app.js';

import {
  buildAllProjects,
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

test('pinned first, then projects with chats; both by latest activity, ties by name', () => {
  const projects = [
    activeAt('Бета', 5),
    activeAt('Альфа', 5),
    activeAt('Старый закреп', 40, { isStarred: true }),
    activeAt('Свежий закреп', 1, { isStarred: true }),
    activeAt('Вчера', 1),
    activeAt('Без чатов закреп', null, { isStarred: true }),
  ];
  const { items, hiddenCount } = buildHomeProjects(projects, { query: '', capacity: 16 });
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

test('Home fills capacity − 1 cells, the last one is left for «All projects»', () => {
  // 4 × 3 grid = 12 cells → 11 projects + the «All projects» tile.
  const projects = Array.from({ length: 20 }, (_, index) => activeAt(`p${String(index).padStart(2, '0')}`, index));
  const { items, hiddenCount } = buildHomeProjects(projects, { query: '', capacity: 12 });
  assert.deepEqual(names(items), ['p00', 'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10']);
  assert.equal(hiddenCount, 9);
});

test('no 14-day or 12-project cutoff: old chats fill free cells', () => {
  const projects = [activeAt('год назад', 365), activeAt('месяц назад', 30), activeAt('вчера', 1)];
  const { items, hiddenCount } = buildHomeProjects(projects, { query: '', capacity: 40 });
  assert.deepEqual(names(items), ['вчера', 'месяц назад', 'год назад']);
  assert.equal(hiddenCount, 0);
});

test('projects without chats stay in the folder and are counted as hidden', () => {
  const projects = [activeAt('с чатом', 3), activeAt('пустой', null), activeAt('ещё пустой', null)];
  const { items, hiddenCount } = buildHomeProjects(projects, { query: '', capacity: 24 });
  assert.deepEqual(names(items), ['с чатом']);
  assert.equal(hiddenCount, 2);
});

test('any number of pinned go first; when they overflow, the rest hides behind «All projects»', () => {
  const pinned = Array.from({ length: 9 }, (_, index) => activeAt(`закреп ${index}`, index, { isStarred: true }));
  const recent = [activeAt('недавний', 0.5)];
  const wide = buildHomeProjects([...recent, ...pinned], { query: '', capacity: 12 });
  assert.deepEqual(names(wide.items), [...pinned.map((project) => project.displayName), 'недавний']);
  assert.equal(wide.hiddenCount, 0);

  const narrow = buildHomeProjects([...recent, ...pinned], { query: '', capacity: 8 });
  assert.deepEqual(names(narrow.items), pinned.slice(0, 7).map((project) => project.displayName));
  assert.equal(narrow.hiddenCount, 3);
});

test('capacity of one cell leaves only «All projects»', () => {
  const { items, hiddenCount } = buildHomeProjects([activeAt('a', 1), activeAt('b', 2)], { query: '', capacity: 1 });
  assert.deepEqual(items, []);
  assert.equal(hiddenCount, 2);
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

  const home = buildHomeProjects([junk, pinnedJunk, real], { query: '', capacity: 16 });
  assert.deepEqual(names(home.items), ['tmp закреп', 'Tyres']);
  assert.equal(home.hiddenCount, 0);

  assert.deepEqual(names(buildAllProjects([junk, pinnedJunk, real])), ['tmp закреп', 'Tyres']);

  const found = buildHomeProjects([junk, pinnedJunk, real], { query: 'чат', capacity: 16 });
  assert.deepEqual(names(found.items), []);
});

test('the folder lists pinned, then with chats by recency, then without chats by name', () => {
  const projects = [
    activeAt('старый', 60),
    activeAt('закреп', 90, { isStarred: true }),
    activeAt('Яблоко', null),
    activeAt('без чатов', null),
    activeAt('вчера', 1),
    projectAt('/private/tmp/x', { displayName: 'x' }),
  ];
  assert.deepEqual(names(buildAllProjects(projects)), ['закреп', 'вчера', 'старый', 'без чатов', 'Яблоко']);
});

test('search covers all non-junk projects by name or path, case-insensitive, no limit', () => {
  const many = Array.from({ length: 20 }, (_, index) => activeAt(`tyres-${index}`, 100 + index));
  const projects = [
    ...many,
    activeAt('Линии Сергея', 50, { fullPath: '/Users/dimasik/Antigravity Project/Tyres-sergey-lines' }),
    activeAt('mazda', 1, { isStarred: true }),
    activeAt('tyres без чатов', null),
    projectAt('/Users/dimasik/Antigravity Project/Tyres/outputs/home-bg', { displayName: 'tyres outputs' }),
  ];
  const { items, hiddenCount } = buildHomeProjects(projects, { query: '  TYRES ', capacity: 4 });
  assert.equal(items.length, 22);
  assert.equal(items[0].displayName, 'Линии Сергея');
  assert.ok(names(items).includes('tyres без чатов'));
  assert.ok(!names(items).includes('tyres outputs'));
  assert.equal(hiddenCount, 0);

  const pinned = buildHomeProjects(projects, { query: 'MAZ', capacity: 4 });
  assert.deepEqual(names(pinned.items), ['mazda']);
});

test('the real 22.11 list: no junk on Home, everything else in the folder', () => {
  const projects = REAL_PROJECTS.map(([name, path], index) =>
    projectAt(path, {
      projectId: `p${index}`,
      displayName: name,
      sessions: [{ id: `s${index}`, lastActivity: new Date(NOW - (index % 20) * DAY).toISOString() }],
    }));
  // iPhone 390 × 844: four columns, four rows.
  const home = buildHomeProjects(projects, { query: '', capacity: 16 });
  assert.equal(home.items.length, 15);
  assert.ok(home.items.every((project) => !isHomeJunkProject(project)));

  const all = buildAllProjects(projects);
  assert.equal(all.length, REAL_PROJECTS.length - 10);
  assert.equal(home.hiddenCount, all.length - 15);
  assert.deepEqual(all.slice(0, 15), home.items);
});
