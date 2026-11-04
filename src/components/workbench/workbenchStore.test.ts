import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkbenchStore, type WorkbenchStorage } from './workbenchStore.js';
import { getWorkbenchTabKind, registerWorkbenchTabKind } from './workbenchTabs.js';

function memoryStorage(): WorkbenchStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test('opening a tab adds it, focuses it and switches the workbench on', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  assert.equal(store.getLayout().enabled, false);

  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });

  const session = store.getSession('s1');
  assert.equal(session.tabs.length, 1);
  assert.equal(session.tabs[0].kind, 'inspector');
  assert.equal(session.tabs[0].title, 'Сессия');
  assert.equal(session.activeTabId, session.tabs[0].id);
  assert.equal(store.getLayout().enabled, true);
  assert.equal(store.getOpenSeq(), 1);
});

test('opening the same tab again focuses it instead of adding a second one', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  store.openTab('s1', { kind: 'limits', title: 'Контекст и лимиты' });
  assert.equal(store.getSession('s1').activeTabId, store.getSession('s1').tabs[1].id);

  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });

  const session = store.getSession('s1');
  assert.deepEqual(session.tabs.map((tab) => tab.kind), ['inspector', 'limits']);
  assert.equal(session.activeTabId, session.tabs[0].id);
});

test('tabs of one kind with different refs are separate; an explicit id is kept', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'artifact', title: 'Отчёт', ref: 'a1' });
  store.openTab('s1', { kind: 'artifact', title: 'Слайды', ref: 'a2' });
  store.openTab('s1', { kind: 'artifact', title: 'Отчёт', ref: 'a1' });
  store.openTab('s1', { id: 'custom', kind: 'report', title: 'Jev' });

  const session = store.getSession('s1');
  assert.deepEqual(session.tabs.map((tab) => tab.ref ?? null), ['a1', 'a2', null]);
  assert.equal(session.tabs[2].id, 'custom');
  assert.equal(session.activeTabId, 'custom');
});

test('closing the active tab focuses its neighbour; closing the last leaves an empty canvas', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  store.openTab('s1', { kind: 'limits', title: 'Контекст и лимиты' });
  const [inspector, limits] = store.getSession('s1').tabs;

  store.closeTab('s1', limits.id);
  assert.deepEqual(store.getSession('s1').tabs.map((tab) => tab.id), [inspector.id]);
  assert.equal(store.getSession('s1').activeTabId, inspector.id);

  store.closeTab('s1', inspector.id);
  assert.deepEqual(store.getSession('s1').tabs, []);
  assert.equal(store.getSession('s1').activeTabId, null);
  // Closing tabs does not switch the workbench off.
  assert.equal(store.getLayout().enabled, true);
});

test('tabs are kept per session and survive a reload', () => {
  const storage = memoryStorage();
  const first = createWorkbenchStore({ storage });
  first.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  first.openTab('s1', { kind: 'limits', title: 'Контекст и лимиты' });
  first.setActive('s1', first.getSession('s1').tabs[0].id);
  first.openTab('s2', { kind: 'limits', title: 'Контекст и лимиты' });
  assert.ok(storage.data.has('neo3.workbench.tabs.s1'));

  const reloaded = createWorkbenchStore({ storage });
  const s1 = reloaded.getSession('s1');
  assert.deepEqual(s1.tabs.map((tab) => tab.kind), ['inspector', 'limits']);
  assert.equal(s1.activeTabId, s1.tabs[0].id);
  assert.deepEqual(reloaded.getSession('s2').tabs.map((tab) => tab.kind), ['limits']);
  assert.deepEqual(reloaded.getSession('s3').tabs, []);
});

test('the layout (on/off and width) is remembered and sent to the account as a JSON string', () => {
  const storage = memoryStorage();
  const saved: string[] = [];
  const store = createWorkbenchStore({ storage, saveLayout: (json) => saved.push(json) });

  store.setEnabled(true);
  store.setRatio(0.6);
  assert.deepEqual(JSON.parse(saved.at(-1)!), { enabled: true, ratio: 0.6 });

  // Out-of-range widths are clamped so neither side disappears.
  store.setRatio(0.99);
  assert.ok(store.getLayout().ratio <= 0.75);
  store.setRatio(0.01);
  assert.ok(store.getLayout().ratio >= 0.25);

  store.setRatio(0.55);
  const reloaded = createWorkbenchStore({ storage });
  assert.deepEqual(reloaded.getLayout(), { enabled: true, ratio: 0.55 });

  store.setEnabled(false);
  assert.equal(createWorkbenchStore({ storage }).getLayout().enabled, false);
});

test('the account layout from another device replaces the local one; broken values are ignored', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });

  store.applyAccountLayout('{"enabled":true,"ratio":0.4}');
  assert.deepEqual(store.getLayout(), { enabled: true, ratio: 0.4 });
  assert.ok(notified > 0);

  store.applyAccountLayout('not json');
  store.applyAccountLayout(undefined);
  assert.deepEqual(store.getLayout(), { enabled: true, ratio: 0.4 });
});

test('snapshots stay the same object until something changes (safe for useSyncExternalStore)', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  const before = store.getSession('s1');
  assert.equal(store.getSession('s1'), before);
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  assert.notEqual(store.getSession('s1'), before);
});

test('tab kinds are registered by later features', () => {
  const render = () => null;
  registerWorkbenchTabKind('advisor', { render, icon: null, defaultTitle: 'Советник' });
  const kind = getWorkbenchTabKind('advisor');
  assert.equal(kind?.defaultTitle, 'Советник');
  assert.equal(kind?.render, render);
  assert.equal(getWorkbenchTabKind('btw'), undefined);
});

test('moveDraftTabs: tabs of a new chat move to the session it became', () => {
  const storage = memoryStorage();
  const store = createWorkbenchStore({ storage });
  store.openTab(null, { kind: 'inspector', title: 'Сессия' });
  store.openTab(null, { kind: 'limits', title: 'Контекст и лимиты' });
  const draft = store.getSession(null);

  store.moveDraftTabs('s-new');

  assert.deepEqual(store.getSession('s-new').tabs, draft.tabs);
  assert.equal(store.getSession('s-new').activeTabId, draft.activeTabId);
  assert.deepEqual(store.getSession(null), { tabs: [], activeTabId: null });
  // Survives a reload: both keys are written.
  const reloaded = createWorkbenchStore({ storage });
  assert.equal(reloaded.getSession('s-new').tabs.length, 2);
  assert.equal(reloaded.getSession(null).tabs.length, 0);
});

test('moveDraftTabs: a session with its own tabs gets the draft ones merged without duplicates', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  store.openTab(null, { kind: 'inspector', title: 'Сессия' });
  store.openTab(null, { kind: 'artifact', title: 'Макет', ref: 'a1' });

  store.moveDraftTabs('s1');

  const kinds = store.getSession('s1').tabs.map((tab) => tab.kind);
  assert.deepEqual(kinds, ['inspector', 'artifact']);
  assert.equal(store.getSession('s1').activeTabId, store.getSession('s1').tabs[1].id);
  assert.equal(store.getSession(null).tabs.length, 0);
});

test('moveDraftTabs: an empty draft leaves the session as it was', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  store.openTab('s1', { kind: 'limits', title: 'Контекст и лимиты' });
  store.setActive('s1', store.getSession('s1').tabs[0].id);
  const before = store.getSession('s1');

  store.moveDraftTabs('s1');

  assert.deepEqual(store.getSession('s1'), before);
});

test('project tabs of the canvas (terminal, files, stats, autopilot, plugin) survive a reload', () => {
  const storage = memoryStorage();
  const store = createWorkbenchStore({ storage });
  store.openTab('s1', { kind: 'terminal', title: 'Терминал' });
  store.openTab('s1', { kind: 'files', title: 'Файлы' });
  store.openTab('s1', { kind: 'stats', title: 'Статистика' });
  store.openTab('s1', { kind: 'autopilot', title: 'Автопилот' });
  store.openTab('s1', { kind: 'plugin', title: 'Плагин', ref: 'web-view' });

  const reloaded = createWorkbenchStore({ storage });
  assert.deepEqual(reloaded.getSession('s1').tabs.map((tab) => tab.kind), ['terminal', 'files', 'stats', 'autopilot', 'plugin']);
  assert.equal(reloaded.getSession('s1').tabs[4].ref, 'web-view');
});

test('openNewTab adds an active «Новая вкладка» each time, like Cmd+T in a browser', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'files', title: 'Файлы' });

  const first = store.openNewTab('s1');
  const second = store.openNewTab('s1');

  const session = store.getSession('s1');
  assert.deepEqual(session.tabs.map((tab) => tab.kind), ['files', 'newtab', 'newtab']);
  assert.deepEqual(session.tabs.slice(1).map((tab) => tab.title), ['Новая вкладка', 'Новая вкладка']);
  assert.notEqual(first, second);
  assert.deepEqual(session.tabs.slice(1).map((tab) => tab.id), [first, second]);
  assert.match(first, /^newtab:/);
  assert.equal(session.activeTabId, second);
  assert.equal(store.getOpenSeq(), 3);
  assert.equal(store.getLayout().enabled, true);
});

test('a new tab survives a reload', () => {
  const storage = memoryStorage();
  const id = createWorkbenchStore({ storage }).openNewTab('s1');

  const reloaded = createWorkbenchStore({ storage }).getSession('s1');
  assert.deepEqual(reloaded.tabs, [{ id, kind: 'newtab', title: 'Новая вкладка' }]);
  assert.equal(reloaded.activeTabId, id);
});

test('replaceTab turns the new tab into the picked one in the same place', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'inspector', title: 'Сессия' });
  const id = store.openNewTab('s1');
  store.openTab('s1', { kind: 'stats', title: 'Статистика' });

  store.replaceTab('s1', id, { kind: 'plugin', title: 'Погода', ref: 'weather' });

  const session = store.getSession('s1');
  assert.deepEqual(session.tabs, [
    { id: 'inspector', kind: 'inspector', title: 'Сессия' },
    { id: 'plugin:weather', kind: 'plugin', title: 'Погода', ref: 'weather' },
    { id: 'stats', kind: 'stats', title: 'Статистика' },
  ]);
  assert.equal(session.activeTabId, 'plugin:weather');
});

test('replaceTab with a tab that is already open closes the new tab and shows the open one', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'terminal', title: 'Терминал' });
  store.openTab('s1', { kind: 'files', title: 'Файлы' });
  const id = store.openNewTab('s1');

  store.replaceTab('s1', id, { kind: 'terminal', title: 'Терминал' });

  const session = store.getSession('s1');
  assert.deepEqual(session.tabs.map((tab) => tab.id), ['terminal', 'files']);
  assert.equal(session.activeTabId, 'terminal');
});

test('replaceTab of a tab that is gone changes nothing', () => {
  const store = createWorkbenchStore({ storage: memoryStorage() });
  store.openTab('s1', { kind: 'files', title: 'Файлы' });
  const before = store.getSession('s1');

  store.replaceTab('s1', 'newtab:missing', { kind: 'stats', title: 'Статистика' });

  assert.equal(store.getSession('s1'), before);
});
