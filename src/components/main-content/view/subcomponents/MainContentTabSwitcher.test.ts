import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assembleMainTabs, tabShowsLabel } from './mainContentTabs.js';

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
