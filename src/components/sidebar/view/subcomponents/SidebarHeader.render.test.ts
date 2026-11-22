import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarHeader from './SidebarHeader.js';

// The sidebar components rely on the automatic JSX runtime.
(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as never;

const render = () => renderToStaticMarkup(React.createElement(SidebarHeader, {
  isPWA: true,
  isMobile: true,
  isLoading: false,
  projectsCount: 30,
  runningSessionsCount: 2,
  recentSessionsCount: 12,
  archivedSessionsCount: 0,
  isArchivedSessionsLoading: false,
  searchFilter: '',
  onSearchFilterChange: noop,
  onClearSearchFilter: noop,
  searchMode: 'projects',
  onSearchModeChange: noop,
  onRefresh: noop,
  isRefreshing: false,
  onCreateProject: noop,
  onCollapseSidebar: noop,
  onGoHome: noop,
  projectSortOrder: 'recent',
  onProjectSortOrderChange: noop,
  t,
}));

/** Markup of one tabs row: from its opening tag up to the search field. */
const rowOf = (html: string, kind: 'phone' | 'desktop') => {
  const start = html.indexOf(`data-sidebar-tabs="${kind}"`);
  assert.ok(start > -1, `${kind} tabs row is marked`);
  const end = html.indexOf('<input', start);
  return html.slice(html.lastIndexOf('<div', start), end);
};

test('phone tabs row fits 320–365 px: «Проекты / Недавние», the A–Я switch and ⚡2 all stay inside', () => {
  // Blind review 23.11: at a 331 px drawer (iPhone 390) ⚡2 went past the
  // right edge — 307 px of row held ~322 px of content. The phone row drops
  // the tab icons (claude.ai's split is two flat text tabs) and tighter gaps;
  // the right cluster never shrinks, the labels may truncate as a last resort.
  const row = rowOf(render(), 'phone');
  const rowClass = row.match(/^<div class="([^"]*)"/)?.[1] ?? '';
  assert.match(rowClass, /(^|\s)min-w-0(\s|$)/);
  assert.match(rowClass, /(^|\s)gap-3(\s|$)/);

  const tabs = [...row.matchAll(/<button[^>]*class="[^"]*sidebar-nav-tab[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(tabs.length, 2);
  for (const [whole, inner] of tabs) {
    assert.doesNotMatch(inner, /<svg/, 'no icon in a phone tab');
    assert.match(whole, /class="[^"]*(^|\s)min-w-0(\s|[^"]*")/);
    assert.match(inner, /class="truncate"/);
  }

  const right = row.match(/<div class="([^"]*ml-auto[^"]*)"/)?.[1] ?? '';
  assert.match(right, /(^|\s)flex-shrink-0(\s|$)/, 'switch and ⚡ never shrink or get pushed out');
  assert.match(row, /role="group"[^>]*aria-label="Project order"|aria-label="Project order"[^>]*role="group"/);
  assert.match(row, /title="Running sessions"/);
});

test('desktop tabs row keeps its icons', () => {
  const row = rowOf(render(), 'desktop');
  const tabs = [...row.matchAll(/<button[^>]*class="[^"]*sidebar-nav-tab[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(tabs.length, 2);
  for (const [, inner] of tabs) assert.match(inner, /<svg/);
});
