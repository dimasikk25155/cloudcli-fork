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

const render = (projects: Project[], initialGridSize = { width: 342, height: 553 }, isMobile = true) =>
  renderToStaticMarkup(React.createElement(HomeLauncher, {
    projects,
    isMobile,
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

test('phone: no ☰ strip on top; ☰ is a round neon button left of the clock digits, settings right', () => {
  const html = render([project('a', 1)]);
  // The old strip with the plain ☰ (MobileMenuButton) is gone.
  assert.doesNotMatch(html, /pwa-menu-button/);
  assert.doesNotMatch(html, /pwa-header-safe/);

  const row = html.slice(html.indexOf('data-home-clock'), html.indexOf('data-home-grid-area'));
  const menu = row.indexOf('data-home-menu');
  const digits = row.indexOf('data-home-time');
  const settings = row.indexOf('data-home-settings');
  assert.ok(menu > 0 && digits > 0 && settings > 0, 'menu, digits and settings share the clock line');
  assert.ok(menu < digits && digits < settings, '☰ — digits — settings');

  // Same look and size as the settings button: a 40 px neon circle.
  const menuButton = row.slice(menu, row.indexOf('</button>', menu));
  assert.match(menuButton, /data-neon-shape="circle"/);
  assert.match(menuButton, /data-neon-glyph="menu"/);
  assert.match(menuButton, /width="40"/);
  assert.match(row.slice(settings), /width="40"/);
  const label = html.match(/aria-label="([^"]+)"[^>]*data-home-menu|data-home-menu[^>]*aria-label="([^"]+)"/);
  assert.ok(label && (label[1] || label[2]), 'the ☰ button has an aria-label');
  // Pinned to the edges of the grid column (left / right), centred on the digits.
  const openTag = (marker: string) => {
    const at = row.indexOf(marker);
    return row.slice(row.lastIndexOf('<button', at), row.indexOf('>', at));
  };
  const classes = (marker: string) => new Set(/class="([^"]+)"/.exec(openTag(marker))?.[1].split(/\s+/));
  for (const [marker, edge] of [['data-home-menu', 'left-0'], ['data-home-settings', 'right-0']]) {
    const tag = classes(marker);
    for (const name of ['absolute', edge, 'top-1/2', '-translate-y-1/2', 'h-10', 'w-10', 'neo3-neon-round']) {
      assert.ok(tag.has(name), `${marker}: ${name}`);
    }
  }
});

test('desktop: no ☰ on Home, settings still on the clock line', () => {
  const html = render([project('a', 1)], { width: 1072, height: 560 }, false);
  assert.doesNotMatch(html, /data-home-menu/);
  assert.match(html.slice(html.indexOf('data-home-clock')), /data-home-settings/);
});
