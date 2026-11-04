import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assembleMainTabs, listPluginTabs, resolveActiveTab, tabShowsLabel } from './mainContentTabs.js';

describe('вкладки шапки', () => {
  it('ставит Автопилот самым правым и прячет дубль статистики из плагина', () => {
    const tabs = assembleMainTabs({
      terminalDisabled: false,
      shouldShowAutopilotTab: true,
      plugins: [
        { enabled: true, name: 'project-stats', displayName: 'Статистика', icon: 'stats.svg' },
        { enabled: true, name: 'custom-board', displayName: 'Доска', icon: 'board.svg' },
      ],
      localize: (_name, displayName) => displayName,
    });

    assert.deepEqual(
      tabs.map((tab) => tab.id),
      ['chat', 'shell', 'files', 'stats', 'plugin:custom-board', 'autopilot'],
    );
  });

  it('в компактном режиме оставляет подпись только у Автопилота', () => {
    const tabs = assembleMainTabs({
      terminalDisabled: true,
      shouldShowAutopilotTab: true,
      plugins: [],
      localize: (_name, displayName) => displayName,
    });

    assert.equal(tabs.some((tab) => tab.id === 'shell'), false);
    assert.equal(tabShowsLabel(tabs[0], true), false);
    assert.equal(tabShowsLabel(tabs[tabs.length - 1], true), true);
    assert.equal(tabShowsLabel(tabs[0], false), true);
  });
});

describe('вкладки плагинов и шапка рабочего стола', () => {
  it('listPluginTabs отдаёт включённые плагины без дубля статистики — тот же список, что у свитчера', () => {
    const plugins = [
      { enabled: true, name: 'project-stats', displayName: 'Статистика', icon: 's.svg' },
      { enabled: false, name: 'off', displayName: 'Выкл', icon: 'o.svg' },
      { enabled: true, name: 'board', displayName: 'Доска', icon: 'b.svg' },
    ];
    const localize = (_name: string, displayName: string) => displayName;
    const listed = listPluginTabs(plugins, localize);
    assert.deepEqual(listed.map((tab) => [tab.pluginName, tab.label]), [['board', 'Доска']]);
    const assembled = assembleMainTabs({ terminalDisabled: false, shouldShowAutopilotTab: false, plugins, localize });
    assert.deepEqual(assembled.filter((tab) => tab.kind === 'plugin').map((tab) => tab.id), listed.map((tab) => tab.id));
  });

  it('при включённом рабочем столе основной вид всегда чат, при выключенном вкладка не трогается', () => {
    assert.equal(resolveActiveTab(true, 'shell'), 'chat');
    assert.equal(resolveActiveTab(true, 'plugin:board'), 'chat');
    assert.equal(resolveActiveTab(false, 'shell'), 'shell');
    assert.equal(resolveActiveTab(false, 'plugin:board'), 'plugin:board');
  });
});
