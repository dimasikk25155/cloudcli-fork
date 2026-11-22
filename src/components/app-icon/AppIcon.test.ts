import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AppIcon from './AppIcon';
import ProjectIcon from './ProjectIcon';
import type { NeonGlyph } from './projectIconSpec';

const render = (glyph: NeonGlyph, extra: Partial<React.ComponentProps<typeof AppIcon>> = {}) =>
  renderToStaticMarkup(React.createElement(AppIcon, { glyph, accent: '#FF6B3D', size: 'md', ...extra }));

test('Neo3 is drawn as a neon tile with its own mark, not a lucide icon', () => {
  const html = render('neo3');
  assert.match(html, /<svg[^>]*data-neon-glyph="neo3"/);
  assert.doesNotMatch(html, /lucide/);
  assert.match(html, /stroke="#FF6B3D"/);
});

test('the clapper glyph is the neon clapper, not lucide', () => {
  const html = render('clapper');
  assert.match(html, /data-neon-glyph="clapper"/);
  assert.doesNotMatch(html, /lucide/);
});

test('sizes stay 28 / 40 / 68 px; the corner «3» is hidden on sm', () => {
  assert.match(render('car', { size: 'sm' }), /class="[^"]*h-7 w-7/);
  assert.match(render('car', { size: 'md' }), /class="[^"]*h-10 w-10/);
  assert.match(render('car', { size: 'lg' }), /class="[^"]*h-\[4\.25rem\] w-\[4\.25rem\]/);
  assert.doesNotMatch(render('car', { size: 'sm' }), /<text/);
  assert.match(render('car', { size: 'lg' }), /<text[^>]*>3<\/text>/);
});

test('the phone sidebar size is 52 px, the same neon tile with its «3»', () => {
  const html = render('car', { size: 'touch' });
  assert.match(html, /class="[^"]*h-\[3\.25rem\] w-\[3\.25rem\]/);
  assert.match(html, /<svg[^>]*width="52"[^>]*height="52"/);
  assert.match(html, /<text[^>]*>3<\/text>/);
});

test('a custom picture wins over the drawing', () => {
  const html = render('car', { src: 'data:image/png;base64,AAAA' });
  assert.match(html, /<img[^>]*src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(html, /data-neon-glyph/);
});

test('the yellow pin dot stays', () => {
  assert.match(render('car', { starred: true }), /bg-amber-400/);
  assert.doesNotMatch(render('car'), /bg-amber-400/);
});

test('ProjectIcon draws the project table icon', () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectIcon, {
      project: { projectId: 'p1', displayName: 'Tyres KZ', fullPath: '/Users/dimasik/Antigravity Project/Tyres' },
      size: 'lg',
      starred: true,
    }),
  );
  assert.match(html, /data-neon-glyph="tire"/);
  assert.match(html, /stroke="#FFC83D"/);
  assert.match(html, /bg-amber-400/);
});
