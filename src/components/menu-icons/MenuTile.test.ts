import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MenuTile from './MenuTile';
import { MENU_ICON_KEYS, menuTileFor, type MenuIconKey } from './menuIconModel';

const render = (iconKey: MenuIconKey, size?: 'sm' | 'md' | 'lg', className?: string) =>
  renderToStaticMarkup(React.createElement(MenuTile, { iconKey, size, className }));

test('every key draws its own picture: an svg of that key, or the pixel crab', () => {
  for (const key of MENU_ICON_KEYS) {
    const html = render(key);
    if (key === 'krabik') {
      assert.match(html, /class="crab /, 'krabik is the pixel crab');
      assert.doesNotMatch(html, /data-menu-icon=/);
    } else {
      assert.match(html, new RegExp(`<svg[^>]*data-menu-icon="${key}"`), key);
      assert.match(html, /viewBox="0 0 24 24"/);
      // Own art, not lucide: lucide stamps class="lucide …" on every icon.
      assert.doesNotMatch(html, /lucide/);
    }
  }
});

test('the tile is painted with the key gradient and hidden from screen readers', () => {
  for (const key of MENU_ICON_KEYS) {
    const html = render(key);
    const background = menuTileFor(key).gradient.replace(/, /g, ',\\s*').replace(/[()]/g, '\\$&');
    assert.match(html, new RegExp(`background:${background}`), key);
    assert.match(html, /^<span[^>]*class="neo3-squircle /);
    assert.match(html, /^<span[^>]*aria-hidden="true"/);
  }
});

test('sizes: sm 28 px, md 40 px, lg 52 px; sm is the default', () => {
  assert.match(render('settings'), /^<span[^>]*\bh-7 w-7\b/);
  assert.match(render('settings', 'md'), /^<span[^>]*\bh-10 w-10\b/);
  assert.match(render('settings', 'lg'), /^<span[^>]*h-\[3\.25rem\] w-\[3\.25rem\]/);
  assert.match(render('settings', 'sm'), /<svg[^>]*class="[^"]*\bh-4 w-4\b/);
  assert.match(render('settings', 'lg'), /<svg[^>]*class="[^"]*\bh-7 w-7\b/);
});

test('a caller class can resize the box (the home dock uses 68 px)', () => {
  const html = render('mazda', 'lg', 'h-[4.25rem] w-[4.25rem]');
  assert.match(html, /^<span[^>]*h-\[4\.25rem\] w-\[4\.25rem\]/);
  assert.doesNotMatch(html, /^<span[^>]*h-\[3\.25rem\]/);
});

test('two tiles of the same icon on one page do not share mask ids', () => {
  const html = renderToStaticMarkup(
    React.createElement(React.Fragment, null,
      React.createElement(MenuTile, { iconKey: 'agents' }),
      React.createElement(MenuTile, { iconKey: 'agents', size: 'lg' })),
  );
  const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 2);
  assert.equal(new Set(ids).size, ids.length);
});
