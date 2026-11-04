import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkbenchLauncher from './WorkbenchLauncher';
import type { WorkbenchMenuEntry } from './workbenchCanvasModel';

const entries: WorkbenchMenuEntry[] = [
  { key: 'terminal', kind: 'terminal', title: 'Терминал', icon: null },
  { key: 'limits', kind: 'limits', title: 'Контекст и лимиты', icon: null },
  { key: 'plugin:weather', kind: 'plugin', ref: 'weather', title: 'Погода', icon: null },
];

const render = (props: Parameters<typeof WorkbenchLauncher>[0]) =>
  renderToStaticMarkup(React.createElement(WorkbenchLauncher, props));

test('one labelled icon button per menu entry, in menu order', () => {
  const html = render({ entries, onPick: () => {} });
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['Терминал', 'Контекст и лимиты', 'Погода']);
  assert.equal((html.match(/<button[^>]*type="button"/g) ?? []).length, 3);
  assert.match(html, />Контекст и лимиты</);
});

test('each tile is painted with its own gradient and a white glyph', () => {
  const html = render({ entries, onPick: () => {} });
  assert.equal((html.match(/background:linear-gradient\(/g) ?? []).length, 3);
  assert.equal((html.match(/<svg/g) ?? []).length, 3);
});

test('tiles give way on press, show keyboard focus and respect reduced motion', () => {
  const html = render({ entries: entries.slice(0, 1), onPick: () => {} });
  assert.match(html, /active:scale-\[0\.92\]/);
  assert.match(html, /focus-visible:ring/);
  assert.match(html, /motion-reduce:transition-none/);
});

test('the grid is an explicit list and takes no hint line', () => {
  const html = render({ entries, onPick: () => {} });
  assert.match(html, /<ul[^>]*role="list"/);
  assert.doesNotMatch(render({ entries, onPick: () => {}, hint: 'Что открыть?' } as Parameters<typeof WorkbenchLauncher>[0]), /Что открыть\?/);
});

test('nothing to open says so', () => {
  assert.match(render({ entries: [], onPick: () => {} }), /Нечего открыть/);
  assert.doesNotMatch(render({ entries: [], onPick: () => {} }), /<button/);
});
