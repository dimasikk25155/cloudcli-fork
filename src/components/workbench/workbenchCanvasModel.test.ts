import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildWorkbenchMenu,
  markVisitedKeepMounted,
  planCanvasPanes,
  type WorkbenchMenuContext,
} from './workbenchCanvasModel.js';
import type { WorkbenchTab, WorkbenchTabKind, WorkbenchTabKindDef } from './workbenchTabs.js';

const def = (title: string, extra: Partial<WorkbenchTabKindDef> = {}): WorkbenchTabKindDef => ({
  defaultTitle: title,
  icon: null,
  render: () => null,
  ...extra,
});

const kinds: Array<[WorkbenchTabKind, WorkbenchTabKindDef]> = [
  ['inspector', def('Сессия', { inMenu: true })],
  ['artifact', def('Артефакт')],
  ['terminal', def('Терминал', { inMenu: true, keepMounted: true, available: (ctx) => !ctx.terminalDisabled })],
  ['autopilot', def('Автопилот', { inMenu: true, available: (ctx) => ctx.autopilotAvailable })],
  ['plugin', def('Плагин', { inMenu: true })],
];

const ctx = (extra: Partial<WorkbenchMenuContext> = {}): WorkbenchMenuContext => ({
  autopilotAvailable: false,
  terminalDisabled: false,
  ...extra,
});

describe('меню «+» холста', () => {
  it('берёт только виды с inMenu и скрывает те, чей available вернул false', () => {
    const titles = buildWorkbenchMenu(kinds, ctx(), []).map((entry) => entry.title);
    assert.deepEqual(titles, ['Сессия', 'Терминал']);
  });

  it('показывает автопилот только когда у проекта есть дашборд, терминал — пока он не запрещён', () => {
    const titles = buildWorkbenchMenu(kinds, ctx({ autopilotAvailable: true, terminalDisabled: true }), []).map((entry) => entry.title);
    assert.deepEqual(titles, ['Сессия', 'Автопилот']);
  });

  it('разворачивает вид plugin в пункт на каждую вкладку плагина с ref = имя', () => {
    const entries = buildWorkbenchMenu(kinds, ctx(), [
      { name: 'board', label: 'Доска' },
      { name: 'notes', label: 'Заметки' },
    ]);
    const plugins = entries.filter((entry) => entry.kind === 'plugin');
    assert.deepEqual(plugins.map((entry) => [entry.ref, entry.title]), [['board', 'Доска'], ['notes', 'Заметки']]);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
  });
});

describe('вкладки, которые держатся смонтированными', () => {
  const tab = (id: string, kind: WorkbenchTabKind): WorkbenchTab => ({ id, kind, title: id });
  const tabs = [tab('inspector', 'inspector'), tab('terminal', 'terminal'), tab('limits', 'limits')];
  const keep = (kind: WorkbenchTabKind) => kind === 'terminal';

  it('до первого открытия терминал не монтируется', () => {
    const visited = markVisitedKeepMounted(new Set(), tabs, 'inspector', keep);
    const panes = planCanvasPanes({ tabs, activeTabId: 'inspector', visited, isKeepMounted: keep });
    assert.deepEqual(panes.map((pane) => pane.tab.id), ['inspector']);
  });

  it('после открытия терминал остаётся скрытым при смене вкладки и не пересоздаётся', () => {
    let visited = markVisitedKeepMounted(new Set(), tabs, 'terminal', keep);
    visited = markVisitedKeepMounted(visited, tabs, 'limits', keep);
    const panes = planCanvasPanes({ tabs, activeTabId: 'limits', visited, isKeepMounted: keep });
    assert.deepEqual(panes.map((pane) => [pane.tab.id, pane.hidden]), [['terminal', true], ['limits', false]]);
  });

  it('закрытая вкладка забывается: повторное открытие начинает с нуля', () => {
    let visited = markVisitedKeepMounted(new Set(), tabs, 'terminal', keep);
    visited = markVisitedKeepMounted(visited, [tabs[0], tabs[2]], 'inspector', keep);
    assert.equal(visited.has('terminal'), false);
  });

  it('активная вкладка с keepMounted не скрыта и не дублируется', () => {
    const visited = markVisitedKeepMounted(new Set(), tabs, 'terminal', keep);
    const panes = planCanvasPanes({ tabs, activeTabId: 'terminal', visited, isKeepMounted: keep });
    assert.deepEqual(panes.map((pane) => [pane.tab.id, pane.hidden]), [['terminal', false]]);
  });
});
