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

/**
 * Markup of one tabs row: from its opening tag up to the search field. The
 * phone header has no field of its own (the bottom bar is the search), so its
 * row runs to the end of the header.
 */
const rowOf = (html: string, kind: 'phone' | 'desktop') => {
  const start = html.indexOf(`data-sidebar-tabs="${kind}"`);
  assert.ok(start > -1, `${kind} tabs row is marked`);
  const end = html.indexOf('<input', start);
  return html.slice(html.lastIndexOf('<div', start), end === -1 ? undefined : end);
};

/** The phone half of the header: everything after the desktop divider. */
const phoneStart = (html: string) => {
  const at = html.indexOf('data-sidebar-header="phone"');
  assert.ok(at > -1, 'the phone header is marked');
  return at;
};
const phoneHeader = (html: string) => html.slice(phoneStart(html));
const desktopHeader = (html: string) => html.slice(0, phoneStart(html));

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

test('phone drawer header: no search field and no Home of its own — both are in the bottom bar', () => {
  const html = render();
  const phone = phoneHeader(html);
  assert.doesNotMatch(phone, /<input/);
  assert.doesNotMatch(phone, /Home screen"[^>]*aria-label|aria-label="Home screen"/);
  // The computer keeps its field and its Home button.
  const desktop = desktopHeader(html);
  assert.match(desktop, /<input[^>]*nav-search-input/);
  assert.match(desktop, /title="Home screen"/);
});

test('phone drawer header: round glass buttons with names, 44 px to the finger', () => {
  const phone = phoneHeader(render());
  const buttons = [...phone.matchAll(/<button[^>]*data-sidebar-header-action="([^"]+)"[^>]*>/g)];
  assert.deepEqual(buttons.map((match) => match[1]), ['refresh', 'create-project']);
  for (const [tag, key] of buttons) {
    const classes = new Set(/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/));
    assert.ok(classes.has('glass-button'), `${key}: glass button`);
    // 36 px to the eye; the invisible ::before adds 5 px around the 34 px
    // padding box — 44 px to the finger (measured on the stand).
    assert.ok(classes.has('h-9') && classes.has('w-9'), `${key}: 36 px`);
    assert.ok(classes.has('before:-inset-[5px]'), `${key}: touch area`);
    assert.match(tag, /aria-label="[^"]+"/, `${key}: has a name`);
  }
});
