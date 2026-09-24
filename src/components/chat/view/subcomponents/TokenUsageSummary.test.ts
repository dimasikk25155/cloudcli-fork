import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TokenUsageSummary from './TokenUsageSummary';

test('chip uses selected maximum instead of runtime or billing totals', () => {
  const html = renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: { used: 258400, total: 200000, inputTokens: 6362841 }, contextWindow: 1000000 }));
  assert.match(html, />26%</);
  assert.match(html, /1.?000.?000/);
  assert.match(html, /200.?000/);
  assert.doesNotMatch(html, />100%</);
});
test('chip distinguishes known zero, missing occupancy and unknown maximum', () => {
  assert.match(renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: { used: 0 }, contextWindow: 1000000 })), />0%</);
  assert.match(renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: null, contextWindow: 1000000 })), />—</);
  assert.match(renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: { used: 10000, total: 200000 } })), />—</);
  assert.match(renderToStaticMarkup(React.createElement(TokenUsageSummary, { usage: { used: 258400 }, contextWindow: 500000 })), />52%</);
});
