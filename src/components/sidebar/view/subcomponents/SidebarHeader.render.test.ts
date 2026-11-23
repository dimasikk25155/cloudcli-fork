import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarHeader from './SidebarHeader.js';

// The sidebar components rely on the automatic JSX runtime.
(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as never;

const render = (searchMode: 'projects' | 'running' = 'projects') => renderToStaticMarkup(React.createElement(SidebarHeader, {
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
  searchMode,
  onSearchModeChange: noop,
  onRefresh: noop,
  isRefreshing: false,
  onCreateProject: noop,
  onCollapseSidebar: noop,
  onGoHome: noop,
  projectSortOrder: 'recent',
  onProjectSortOrderChange: noop,
  sessionSortOrder: 'prompt',
  onSessionSortOrderChange: noop,
  t,
}));

/** Markup of one tabs row: from its opening tag up to the search field. */
const rowOf = (html: string, kind: 'phone' | 'desktop') => {
  const start = html.indexOf(`data-sidebar-tabs="${kind}"`);
  assert.ok(start > -1, `${kind} tabs row is marked`);
  const end = html.indexOf('<input', start);
  return html.slice(html.lastIndexOf('<div', start), end);
};

test('one list, no tabs: the row holds chat order, project order and ⚡N (23.11)', () => {
  // Dima's voice note 23.11: «Недавние» as a tab is gone; chats inside each
  // project are ordered «Новые» (creation) or «Недавние» (his last message).
  for (const kind of ['phone', 'desktop'] as const) {
    const row = rowOf(render(), kind);
    assert.doesNotMatch(row, /sidebar-nav-tab/, `${kind}: no tabs left`);
    assert.match(row, /aria-label="Порядок чатов"/);
    assert.match(row, /data-session-sort="prompt"/);
    assert.match(row, />Новые</);
    assert.match(row, />Недавние</);
    assert.match(row, /aria-label="Project order"/);
    assert.match(row, /title="Running sessions"/);
  }
});

test('phone row fits 320–365 px: the right cluster never shrinks', () => {
  const row = rowOf(render(), 'phone');
  const rowClass = row.match(/^<div class="([^"]*)"/)?.[1] ?? '';
  assert.match(rowClass, /(^|\s)min-w-0(\s|$)/);
  const right = row.match(/<div class="([^"]*ml-auto[^"]*)"/)?.[1] ?? '';
  assert.match(right, /(^|\s)flex-shrink-0(\s|$)/, 'switch and ⚡ never shrink or get pushed out');
});

test('outside the projects list (⚡N view) the row offers the way back instead of the switches', () => {
  const row = rowOf(render('running'), 'phone');
  assert.doesNotMatch(row, /Порядок чатов/);
  assert.match(row, /search\.modeProjects/);
  assert.match(row, /aria-pressed="true"[^>]*title="Running sessions"|title="Running sessions"[^>]*aria-pressed="true"/);
});
