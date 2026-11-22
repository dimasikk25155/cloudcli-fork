import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import NeonTile from './NeonTile';
import { NEON_GLYPHS, type NeonGlyph } from './neonGlyphs';
import { NEON_ACCENTS, NEON_BASE, NEON_WHITE } from './neonPalette';

const render = (props: Partial<React.ComponentProps<typeof NeonTile>> = {}) =>
  renderToStaticMarkup(React.createElement(NeonTile, { glyph: 'envelope', accent: '#FFB547', size: 'lg', ...props }));

const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

test('a tile is one svg in the bot-avatar style', () => {
  const html = render();
  assert.match(html, /^<svg[^>]*viewBox="0 0 100 100"/);
  assert.match(html, /^<svg[^>]*data-neon-glyph="envelope"/);
  assert.equal(html.match(/<svg/g)?.length, 1);
  // Dark base, radial glow of the accent, a thin accent ring.
  assert.match(html, new RegExp(`fill="${NEON_BASE}"`));
  assert.match(html, /<radialGradient/);
  assert.match(html, /stroke="#FFB547"/);
  // Glowing symbol: blur filter flooded with the accent.
  assert.match(html, /<feGaussianBlur/);
  assert.match(html, /flood-color="#FFB547"/);
});

test('the symbol is two-coloured: white plus the accent', () => {
  const html = render();
  assert.match(html, new RegExp(`color="${NEON_WHITE}"`));
  assert.match(html, /color="#FFB547"/);
});

test('every glyph draws something in white or accent, never letters', () => {
  for (const glyph of Object.keys(NEON_GLYPHS) as NeonGlyph[]) {
    const html = render({ glyph, showMark: false });
    assert.match(html, /<(path|rect|circle|ellipse)\b/, glyph);
    assert.doesNotMatch(html, /<text/, glyph);
  }
});

test('every glyph has a white part and an accent part', () => {
  for (const [glyph, art] of Object.entries(NEON_GLYPHS)) {
    assert.ok(art.white || art.top, `${glyph}: white`);
    assert.ok(art.accent, `${glyph}: accent`);
  }
});

test('the set covers every symbol of the Neo³ bot avatars', () => {
  // make_avatars.py: laptop, rack, window, envelope, star, cashback, coupon, clapper, robot, mic,
  // headphones, car, parcel, sliders, coin, shield, bubble, tag, plane, rss, insta, bars.
  const botSymbols = [
    'laptop', 'server', 'windows', 'envelope', 'star', 'cashback', 'coupon', 'clapper', 'robot', 'mic',
    'headphones', 'car', 'parcel', 'sliders', 'bitcoin', 'shield', 'speech', 'tag', 'plane', 'rss',
    'camera', 'bars',
  ];
  for (const glyph of botSymbols) {
    assert.ok(glyph in NEON_GLYPHS, glyph);
  }
});

test('the small "3" sits in the corner on big tiles, not on sm', () => {
  assert.match(render({ size: 'lg' }), /<text[^>]*>3<\/text>/);
  assert.match(render({ size: 'md' }), /<text[^>]*>3<\/text>/);
  assert.doesNotMatch(render({ size: 'sm' }), /<text/);
  assert.doesNotMatch(render({ size: 'lg', showMark: false }), /<text/);
  assert.match(render({ size: 68 }), /<text[^>]*>3<\/text>/);
});

test('size maps to pixels: sm 28, md 40, lg 68, or a number', () => {
  assert.match(render({ size: 'sm' }), /^<svg[^>]*width="28"[^>]*height="28"/);
  assert.match(render({ size: 'md' }), /^<svg[^>]*width="40"/);
  assert.match(render({ size: 'lg' }), /^<svg[^>]*width="68"/);
  assert.match(render({ size: 52 }), /^<svg[^>]*width="52"/);
});

test('filter and gradient ids are unique per tile', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      'div',
      null,
      React.createElement(NeonTile, { glyph: 'car', accent: '#F43F5E', size: 'lg' }),
      React.createElement(NeonTile, { glyph: 'car', accent: '#F43F5E', size: 'lg' }),
    ),
  );
  const all = ids(html);
  assert.ok(all.length >= 4, 'gradient, filter and mask on both tiles');
  assert.equal(new Set(all).size, all.length);
  for (const id of all) {
    assert.match(id, /^[A-Za-z][\w-]*$/, 'safe inside url(#…)');
    assert.ok(html.includes(`url(#${id})`), `${id} is referenced`);
  }
});

test('the palette is the bot-avatar palette', () => {
  assert.equal(NEON_ACCENTS.length, 22);
  assert.ok(NEON_ACCENTS.includes('#F43F5E'));
  assert.ok(NEON_ACCENTS.every((hex) => /^#[0-9A-F]{6}$/.test(hex)));
});

test('a round tile (the Home settings button) is a circle with a circular ring', () => {
  const round = render({ glyph: 'settings', accent: '#7DD3FC', size: 40, shape: 'circle', showMark: false });
  assert.match(round, /^<svg[^>]*data-neon-shape="circle"/);
  assert.match(round, /<rect width="100" height="100" rx="50"/);
  assert.match(round, /<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="4[\d.]+" fill="none" stroke="#7DD3FC"/);

  const squircle = render();
  assert.match(squircle, /^<svg[^>]*data-neon-shape="squircle"/);
  assert.match(squircle, /<rect width="100" height="100" rx="22.5"/);
});
