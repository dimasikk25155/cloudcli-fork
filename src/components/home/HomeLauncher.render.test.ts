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

const render = (
  projects: Project[],
  initialGridSize = { width: 342, height: 553 },
  isMobile = true,
  extras: Partial<React.ComponentProps<typeof HomeLauncher>> = {},
) =>
  renderToStaticMarkup(React.createElement(HomeLauncher, {
    projects,
    isMobile,
    onProjectSelect: () => undefined,
    onShowSettings: () => undefined,
    onToggleStarProject: () => undefined,
    initialGridSize,
    ...extras,
  }));

/** More real projects than `SEARCH_MIN_PROJECTS` — the count that brings the search field. */
const manyProjects = () => Array.from({ length: 12 }, (_, index) => project(`p${String(index).padStart(2, '0')}`, index + 1));

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

test('no dock tiles, no Канцелярия bell; on a computer settings is a round button next to the clock', () => {
  const html = render([project('a', 1)], { width: 1072, height: 560 }, false);
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

test('the «работают · ждут · готово» bar of the chat sits under the date, above the grid', async () => {
  // Fill the app-wide attention store the way the app does: GET /api/attention.
  const globals = globalThis as { localStorage?: unknown; fetch?: typeof fetch };
  const savedFetch = globals.fetch;
  const savedStorage = globals.localStorage;
  globals.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  globals.fetch = (async () => new Response(JSON.stringify({
    items: [{ sessionId: 's-1', projectId: 'a', state: 'working', unread: false, updatedAt: new Date(NOW).toISOString() }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const { attentionStore } = await import('../attention/useAttention.js');
    await attentionStore.refresh();
    const html = render([project('a', 1)]);
    const status = html.indexOf('data-home-status');
    assert.ok(status > 0, 'status slot is rendered');
    // The very component shown above the chat composer, not a copy.
    assert.ok(html.indexOf('data-session-hub-bar', status) > status);
    assert.match(html, /работают 1/);
    assert.ok(html.indexOf('data-home-clock') < status, 'under the clock and date');
    assert.ok(status < html.indexOf('data-home-grid-area'), 'above the projects');
  } finally {
    globals.fetch = savedFetch;
    globals.localStorage = savedStorage;
  }
});

test('phone: the clock line is digits only — ☰, settings and search live in the bottom bar', () => {
  const html = render(manyProjects());
  // The old strip with the plain ☰ (MobileMenuButton) is gone.
  assert.doesNotMatch(html, /pwa-menu-button/);
  assert.doesNotMatch(html, /pwa-header-safe/);

  // The clock line itself, up to the status slot under the date.
  const row = html.slice(html.indexOf('data-home-clock'), html.indexOf('data-home-status'));
  assert.match(row, /data-home-time/);
  // No duplicates of the bar's buttons next to the clock (story 26).
  assert.doesNotMatch(html, /data-home-menu/);
  assert.doesNotMatch(html, /data-home-settings/);
  assert.doesNotMatch(row, /<button/);
  // Home's own search field is gone on a phone even with many projects.
  assert.doesNotMatch(html, /type="search"/);
});

test('desktop: no ☰ on Home, settings on the clock line and the search field as before', () => {
  const html = render(manyProjects(), { width: 1072, height: 560 }, false);
  assert.doesNotMatch(html, /data-home-menu/);
  assert.match(html.slice(html.indexOf('data-home-clock')), /data-home-settings/);
  const search = /<input[^>]*type="search"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(search, /placeholder="Find a project"/);
  assert.ok(html.indexOf('type="search"') < html.indexOf('data-home-grid-area'), 'above the grid');
  // The bar's query belongs to the phone: a computer keeps its own field.
  assert.equal(tileIds(render(manyProjects(), { width: 1072, height: 560 }, false, { navQuery: 'p03' })).length, 12);
});

test('phone: the bottom bar\'s query filters the projects of Home', () => {
  const html = render(manyProjects(), undefined, true, { navQuery: 'p03', navSearchActive: true });
  assert.deepEqual(tileIds(html), ['p03']);
  // While searching the «All projects» tile steps aside, as with the old field.
  assert.doesNotMatch(html, /data-home-more="all"/);
  const none = render(manyProjects(), undefined, true, { navQuery: 'нет-такого' });
  assert.deepEqual(tileIds(none), []);
  assert.match(none, /No matching projects/);
});

test('phone: the grid area leaves room for the bottom bar', () => {
  const html = render([project('a', 1)]);
  const area = /<div[^>]*data-home-grid-area[^>]*>/.exec(html)?.[0] ?? '';
  const classes = new Set(/class="([^"]*)"/.exec(area)?.[1].split(/\s+/));
  // The grid counts whole rows in the content box, so the padding is what
  // keeps the last row above the bar (`--bottom-bar-space`, index.css).
  assert.ok(classes.has('pb-[calc(var(--bottom-bar-space)+0.75rem)]'), [...classes].join(' '));
  assert.ok(!classes.has('pb-3'));
});
