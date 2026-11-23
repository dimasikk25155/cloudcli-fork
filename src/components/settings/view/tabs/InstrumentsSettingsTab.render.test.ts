import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import InstrumentsSettingsTab from './InstrumentsSettingsTab.js';

// Состав — из прав бывшего «Меню» (таск 04, критерии приёмки), не из кода.
const EVERYONE = ['nightshift', 'consigliere', 'mazda', 'agent-workspace', 'schedules', 'pipelines', 'governance'];
const OWNER_ALL = [...EVERYONE, 'server', 'duet', 'agents', 'queue', 'krabik'];
const ALL_MODS = { modDuet: true, modAgents: true, modAgentQueue: true, modKrabikAgent: true };

const render = (props: Partial<React.ComponentProps<typeof InstrumentsSettingsTab>> = {}) =>
  renderToStaticMarkup(
    React.createElement(InstrumentsSettingsTab, {
      access: { isOwner: true, mods: ALL_MODS },
      attentionCount: 0,
      onOpenPanel: () => undefined,
      ...props,
    }),
  );

const rows = (html: string) => [...html.matchAll(/<button[^>]*data-tool-panel="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
const rowKeys = (html: string) => rows(html).map((match) => match[1]);

test('владелец со всеми модами видит двенадцать экранов в порядке бывшего «Меню»', () => {
  assert.deepEqual(rowKeys(render()), OWNER_ALL);
});

test('не-владелец видит семь экранов: ни «Сервера», ни экранов модов', () => {
  assert.deepEqual(rowKeys(render({ access: { isOwner: false, mods: ALL_MODS } })), EVERYONE);
});

test('владелец без «Агентов» не видит и «Конвейер»', () => {
  const html = render({ access: { isOwner: true, mods: { ...ALL_MODS, modAgents: false } } });
  assert.deepEqual(rowKeys(html), OWNER_ALL.filter((key) => key !== 'agents' && key !== 'queue'));
});

test('строка — это значок, название и фраза «для чего»', () => {
  const byKey = new Map(rows(render()).map((match) => [match[1], match[2]]));
  const schedules = byKey.get('schedules') ?? '';
  assert.match(schedules, /data-menu-tile="schedules"/, 'свой значок экрана');
  assert.match(schedules, />Расписания</);
  assert.match(schedules, /запускается сам, по времени/);
  const server = byKey.get('server') ?? '';
  assert.match(server, />Сервер</);
  assert.match(server, /что упало и почему/);
  for (const [key, body] of byKey) {
    assert.match(body, /data-tool-purpose/, `${key}: есть «для чего»`);
  }
});

test('красный счётчик стоит на строке «Канцелярия» и только на ней', () => {
  const quiet = render();
  assert.doesNotMatch(quiet, /data-attention-count/);

  const hot = rows(render({ attentionCount: 3 }));
  const marked = hot.filter((match) => /data-attention-count/.test(match[2]));
  assert.deepEqual(marked.map((match) => match[1]), ['consigliere']);
  assert.match(marked[0][2], /data-attention-count="3"[^>]*>3</);
  // Больше девяти — «9+», как на прежней плитке.
  assert.match(render({ attentionCount: 12 }), /data-attention-count="12"[^>]*>9\+</);
});
