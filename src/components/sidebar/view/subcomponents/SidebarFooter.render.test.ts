import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarFooter from './SidebarFooter.js';

const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as never;

const render = (props: Partial<React.ComponentProps<typeof SidebarFooter>> = {}) =>
  renderToStaticMarkup(
    React.createElement(SidebarFooter, {
      restartRequired: false,
      currentVersion: '9.9.9',
      onShowSettings: () => undefined,
      attentionCount: 0,
      t,
      ...props,
    }),
  );

const settingsButton = (html: string) => /<button[^>]*data-sidebar-settings[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
const classesOf = (tag: string) => new Set(/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/));

test('в подвале шторки нет блока «Меню»: ни складки, ни плиток экранов', () => {
  const html = render();
  assert.doesNotMatch(html, />Меню</);
  assert.doesNotMatch(html, /aria-expanded/);
  assert.doesNotMatch(html, /data-menu-tile/);
  for (const label of ['Канцелярия', 'Расписания', 'Сервер', 'Мазда']) {
    assert.ok(!html.includes(label), label);
  }
});

test('на компьютере внизу одна кнопка «Настройки»; на телефоне её нет — она в нижней панели', () => {
  const button = settingsButton(render());
  assert.match(button, /actions\.settings/);
  const classes = classesOf(button);
  assert.ok(classes.has('hidden') && classes.has('md:flex'), 'видна только от 768 px');
  assert.equal((render().match(/<button/g) ?? []).length, 1);
});

test('строка версии и баннер перезапуска на месте', () => {
  assert.match(render(), /Neo3 Agent System v9\.9\.9/);
  assert.doesNotMatch(render(), /version\.restartRequired/);
  assert.match(render({ restartRequired: true }), /version\.restartRequired/);
});

test('счётчик «Канцелярии» стоит на кнопке «Настройки»', () => {
  assert.doesNotMatch(render(), /data-attention-count/);
  assert.match(settingsButton(render({ attentionCount: 2 })), /data-attention-count="2"/);
});

test('подвал не держит ни экранов, ни слушателей: это дело ToolPanelsHost', () => {
  const source = readFileSync(fileURLToPath(new URL('./SidebarFooter.tsx', import.meta.url)), 'utf8');
  for (const gone of ['PanelModal', 'addEventListener', 'useAuth', 'useModEnabled', 'URLSearchParams']) {
    assert.ok(!source.includes(gone), gone);
  }
});
