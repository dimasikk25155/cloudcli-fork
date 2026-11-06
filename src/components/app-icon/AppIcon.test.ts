import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AppIcon from './AppIcon';
import type { ProjectGlyph } from './projectIconSpec';

const render = (glyph: ProjectGlyph) =>
  renderToStaticMarkup(React.createElement(AppIcon, { background: '#D97757', foreground: '#FFF7F0', glyph, letter: 'C', size: 'md' }));

test('Neo3 is drawn with its own mark, not a lucide icon', () => {
  const html = render('neo3');
  assert.match(html, /<svg[^>]*data-neo3-mark/);
  assert.doesNotMatch(html, /lucide/);
  assert.match(html, /color:#FFF7F0/);
});

test('the clapper glyph is the lucide clapperboard', () => {
  assert.match(render('clapper'), /lucide-clapperboard/);
});
