import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AccountContent from './AccountContent.js';

// Логотип движка (чужая зона) собран без явного импорта React — как в приложении, где он глобальный.
(globalThis as { React?: unknown }).React = React;

const render = (authenticated: boolean) =>
  renderToStaticMarkup(
    React.createElement(AccountContent, {
      agent: 'claude',
      authStatus: { authenticated, email: null, loading: false, error: null, method: 'cli' } as never,
      onLogin: () => undefined,
    }),
  );

test('кнопка входа на телефоне стоит под текстом (строка настроек stacked), а не сбоку', () => {
  for (const authenticated of [false, true]) {
    const out = render(authenticated);
    assert.match(out, /data-row-layout="stacked"/, `authenticated=${authenticated}`);
    // Рядом с описанием кнопку держит только SettingsRow: без его раскладки
    // ряд «justify-between» без flex-col сжимает описание в столбик.
    assert.doesNotMatch(out, /class="flex items-center justify-between"/);
  }
});
