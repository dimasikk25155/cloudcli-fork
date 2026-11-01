import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { codexWindowLabel } from '../../../../utils/codexUsageLimits';

import UsageLimitsBadge from './UsageLimitsBadge';
import { CodexLimitsContent } from './CodexUsageLimitsBadge';

test('Codex badge never shows the Claude subscription or links to Claude', () => {
  for (const props of [{ provider: 'codex', model: 'gpt-6.1-sol' }, { provider: 'codex', model: 'future-model' }, { model: 'gpt-6.1-sol' }]) {
    const html = renderToStaticMarkup(React.createElement(UsageLimitsBadge, props));
    assert.match(html, /Лимиты Codex/);
    assert.doesNotMatch(html, /Claude|claude\.ai|5ч/);
  }
  const claude = renderToStaticMarkup(React.createElement(UsageLimitsBadge, { provider: 'claude', model: 'opus[1m]' }));
  assert.match(claude, /claude\.ai/);
});

test('Codex menu renders actual windows, known zero, Moscow resets and unavailable data', () => {
  const html = renderToStaticMarkup(React.createElement(CodexLimitsContent, { usage: {
    windows: [{ utilization: 0, windowMinutes: 10080, resetsAt: '2026-11-07T16:31:00.000Z' }], planType: 'pro', fetchedAt: '2026-10-31T19:00:00.000Z',
  } }));
  assert.match(html, /Окно 7д/);
  assert.match(html, /Использовано 0%/);
  assert.match(html, /19:31.*МСК/);
  assert.match(html, /chatgpt\.com\/codex\/settings\/usage/);
  assert.doesNotMatch(html, /5ч|Claude/);
  const missing = renderToStaticMarkup(React.createElement(CodexLimitsContent, { usage: null }));
  assert.match(missing, /недоступны/);
  assert.doesNotMatch(missing, /0%/);
  assert.deepEqual([300, 10080, 15].map(codexWindowLabel), ['5ч', '7д', '15мин']);
});
