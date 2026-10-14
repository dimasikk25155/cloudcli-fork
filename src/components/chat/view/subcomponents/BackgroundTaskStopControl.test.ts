import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import BackgroundTaskStopControl from './BackgroundTaskStopControl';

const render = (props: Parameters<typeof BackgroundTaskStopControl>[0]) =>
  renderToStaticMarkup(React.createElement(BackgroundTaskStopControl, props));

test('a task the server cannot stop has no «Стоп» — the row names the engine that can', () => {
  const html = render({ stoppable: false, engine: 'Grok', onStop: () => {} });
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /остановить может только сам Grok/);
  assert.match(render({ stoppable: false, engine: 'Codex', onStop: () => {} }), /остановить может только сам Codex/);
});

test('a Claude task keeps its «Стоп» button', () => {
  const html = render({ stoppable: true, engine: 'Claude', onStop: () => {} });
  assert.match(html, /<button[^>]*>Стоп<\/button>/);
  assert.doesNotMatch(html, /только сам Grok/);
});
