import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Project } from '../../types/app.js';

import HomeLauncher from './HomeLauncher.js';

// MobileMenuButton (outside this folder) relies on the automatic JSX runtime.
(globalThis as { React?: typeof React }).React = React;

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const project = (name: string, daysAgo: number | null, extras: Partial<Project> = {}): Project => ({
  projectId: name,
  displayName: name,
  fullPath: `/Users/dimasik/Antigravity Project/${name}`,
  path: `/Users/dimasik/Antigravity Project/${name}`,
  sessions: daysAgo === null ? [] : [{ id: `${name}-s`, lastActivity: new Date(NOW - daysAgo * DAY).toISOString() }],
  ...extras,
});

const render = (projects: Project[], initialGridSize = { width: 342, height: 553 }) =>
  renderToStaticMarkup(React.createElement(HomeLauncher, {
    projects,
    isMobile: true,
    onMenuClick: () => undefined,
    onProjectSelect: () => undefined,
    onShowSettings: () => undefined,
    onToggleStarProject: () => undefined,
    initialGridSize,
  }));

const tileIds = (html: string) => [...html.matchAll(/data-home-project="([^"]+)"/g)].map((match) => match[1]);

test('Home on a 390 px phone: 4 × 4 cells, 15 projects and «All projects» last', () => {
  const projects = [
    ...Array.from({ length: 20 }, (_, index) => project(`p${String(index).padStart(2, '0')}`, index + 1)),
    project('закреп', 90, { isStarred: true }),
  ];
  const html = render(projects);
  assert.match(html, /data-home-grid="4x4"/);
  const ids = tileIds(html);
  assert.equal(ids.length, 15);
  assert.equal(ids[0], 'закреп');
  // «All projects» is the very last cell of the grid, with the hidden count.
  assert.match(html, /data-home-more="all" data-hidden-count="6"/);
  assert.ok(html.lastIndexOf('data-home-project=') < html.indexOf('data-home-more="all"'));
});

test('no dock tiles, no Канцелярия bell; settings is a round button next to the clock', () => {
  const html = render([project('a', 1)]);
  for (const gone of ['Канцелярия', 'Мазда', 'Задачи', 'data-dock-tile']) {
    assert.ok(!html.includes(gone), gone);
  }
  const clock = html.slice(html.indexOf('data-home-clock'), html.indexOf('data-home-grid-area'));
  assert.match(clock, /data-home-settings/);
  assert.match(clock, /data-neon-shape="circle"/);
  assert.match(clock, /data-neon-glyph="settings"/);
  // Settings is not a grid tile any more.
  const grid = html.slice(html.indexOf('data-home-grid-area'));
  assert.doesNotMatch(grid, /data-neon-glyph="settings"/);
});

test('«All projects» stays even when nothing is hidden', () => {
  const html = render([project('a', 1), project('b', 2)]);
  assert.deepEqual(tileIds(html), ['a', 'b']);
  assert.match(html, /data-home-more="all"/);
});

test('a short screen still shows one row', () => {
  const html = render(Array.from({ length: 10 }, (_, index) => project(`p${index}`, index + 1)), { width: 342, height: 30 });
  assert.match(html, /data-home-grid="4x1"/);
  assert.equal(tileIds(html).length, 3);
});
