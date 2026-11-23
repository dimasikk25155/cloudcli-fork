import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../types/app.js';

import {
  BOTTOM_BAR_ITEMS,
  activeBottomBarItem,
  isBottomBarVisible,
  pickNewChatProject,
  settingsTabForAttention,
} from './bottomBarModel.js';

const NOW = Date.parse('2026-11-23T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const project = (name: string, daysAgo: number | null, extras: Partial<Project> = {}): Project => ({
  projectId: name,
  displayName: name,
  fullPath: `/Users/dimasik/Antigravity Project/${name}`,
  path: `/Users/dimasik/Antigravity Project/${name}`,
  sessions: daysAgo === null ? [] : [{ id: `${name}-s`, lastActivity: new Date(NOW - daysAgo * DAY).toISOString() }],
  ...extras,
});

const state = (overrides: Partial<Parameters<typeof isBottomBarVisible>[0]> = {}) => ({
  isMobile: true,
  isHome: true,
  drawerOpen: false,
  keyboardOpen: false,
  searchActive: false,
  ...overrides,
});

test('панель: пять пунктов в порядке из брифа', () => {
  assert.deepEqual([...BOTTOM_BAR_ITEMS], ['home', 'projects', 'search', 'new-chat', 'settings']);
});

test('панель видна на телефоне на «Домой» и в открытой шторке', () => {
  assert.equal(isBottomBarVisible(state()), true);
  assert.equal(isBottomBarVisible(state({ isHome: false, drawerOpen: true })), true);
});

test('в открытом чате панели нет, пока шторка закрыта', () => {
  assert.equal(isBottomBarVisible(state({ isHome: false, drawerOpen: false })), false);
});

test('на компьютере панели нет нигде', () => {
  assert.equal(isBottomBarVisible(state({ isMobile: false })), false);
  assert.equal(isBottomBarVisible(state({ isMobile: false, isHome: false, drawerOpen: true })), false);
});

test('клавиатура прячет панель, кроме случая, когда печатают в её же поиске', () => {
  assert.equal(isBottomBarVisible(state({ keyboardOpen: true })), false);
  assert.equal(isBottomBarVisible(state({ keyboardOpen: true, searchActive: true })), true);
  // Поиск не возвращает панель туда, где её не бывает.
  assert.equal(isBottomBarVisible(state({ isHome: false, keyboardOpen: true, searchActive: true })), false);
});

test('активный пункт: «Проекты» в шторке, «Домой» на главной, в чате — никакой', () => {
  assert.equal(activeBottomBarItem({ isHome: true, drawerOpen: false }), 'home');
  // Шторка лежит поверх главной — на экране список проектов.
  assert.equal(activeBottomBarItem({ isHome: true, drawerOpen: true }), 'projects');
  assert.equal(activeBottomBarItem({ isHome: false, drawerOpen: true }), 'projects');
  assert.equal(activeBottomBarItem({ isHome: false, drawerOpen: false }), null);
});

test('новый чат — в проекте с самым свежим разговором', () => {
  const projects = [project('старый', 9), project('свежий', 1), project('средний', 4), project('без-чатов', null)];
  assert.equal(pickNewChatProject(projects)?.projectId, 'свежий');
});

test('новый чат: проектов с разговорами нет — выбирать не из чего', () => {
  assert.equal(pickNewChatProject([]), null);
  assert.equal(pickNewChatProject([project('пусто', null), project('тоже', null)]), null);
});

test('новый чат не уходит в служебную папку, которой нет на «Домой»', () => {
  const scratch = project('tmp-run', 0, { fullPath: '/private/tmp/run', path: '/private/tmp/run' });
  assert.equal(pickNewChatProject([scratch, project('рабочий', 3)])?.projectId, 'рабочий');
  // Закреплённую руками папку «Домой» показывает — значит, и чат в ней ждут.
  const pinned = { ...scratch, isStarred: true };
  assert.equal(pickNewChatProject([pinned, project('рабочий', 3)])?.projectId, 'tmp-run');
});

test('кнопка настроек со счётчиком ведёт на «Инструменты», без него — как обычно', () => {
  assert.equal(settingsTabForAttention(2), 'instruments');
  assert.equal(settingsTabForAttention(0), undefined);
});
