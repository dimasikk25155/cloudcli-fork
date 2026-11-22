import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Project } from '../../../../types/app.js';

import SidebarProjectItem from './SidebarProjectItem.js';

// The sidebar components rely on the automatic JSX runtime.
(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as never;

const project: Project = {
  projectId: 'p1',
  name: 'claude-agent',
  displayName: 'claude agent',
  fullPath: '/Users/dimasik/Antigravity Project/claude agent',
  path: '/Users/dimasik/Antigravity Project/claude agent',
  sessions: [],
} as Project;

const session = {
  id: 's1',
  summary: 'Пункты под спойлер',
  lastActivity: new Date().toISOString(),
  __provider: 'claude',
};

const render = () => renderToStaticMarkup(React.createElement(SidebarProjectItem, {
  project,
  selectedProject: null,
  selectedSession: null,
  isExpanded: true,
  isDeleting: false,
  isStarred: true,
  editingProject: null,
  editingName: '',
  sessions: [session] as never,
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date(),
  editingSession: null,
  editingSessionName: '',
  onEditingNameChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onSessionSelect: noop,
  onLoadMoreSessions: noop,
  activeSessions: new Map() as never,
  onNewSession: noop,
  onEditingSessionNameChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onDeleteSession: noop,
  onReorderSessions: noop,
  t,
}));

/** The phone copy of a card is the `md:hidden` block; the computer copy is `hidden md:…`. */
const phonePart = (html: string, from: string) => {
  const start = html.indexOf('class="md:hidden"', html.indexOf(from));
  return html.slice(start, html.indexOf('class="hidden md:', start));
};

test('phone project card: 52 px neon icon and a 17 px name', () => {
  const html = render();
  const phone = phonePart(html, 'md:group group');
  assert.match(phone, /h-\[3\.25rem\] w-\[3\.25rem\]/);
  assert.match(phone, /<svg[^>]*width="52"/);
  assert.match(phone, /<h3 class="[^"]*text-\[17px\][^"]*"[^>]*>claude agent<\/h3>/);
});

test('phone chat row: 16 px name and a taller card', () => {
  const html = render();
  const name = html.indexOf('Пункты под спойлер');
  const phone = html.slice(html.lastIndexOf('class="md:hidden"', name), name);
  assert.match(phone, /py-3/);
  assert.match(phone, /text-base[^"]*">$/);
});

test('the computer sidebar keeps its sizes: 28 px icon, 14 px names', () => {
  const html = render();
  const desktop = html.slice(html.indexOf('hidden md:flex'));
  assert.match(desktop, /h-7 w-7/);
  assert.doesNotMatch(desktop.slice(0, 4000), /h-\[3\.25rem\]/);
  const desktopRow = html.slice(html.indexOf('hidden md:block'));
  assert.match(desktopRow, /truncate text-sm font-normal text-foreground">Пункты под спойлер/);
});
