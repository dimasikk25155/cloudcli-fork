import assert from 'node:assert/strict';
import test from 'node:test';

import { firstLetter, monogram, resolveProjectIcon } from './projectIconSpec.js';

test('picks a tire glyph for Tyres projects', () => {
  assert.equal(resolveProjectIcon('Tyres KZ').glyph, 'tire');
  assert.equal(resolveProjectIcon('Samruk Tyres').background, '#1C1917');
});

test('picks a car glyph for Mazda', () => {
  assert.equal(resolveProjectIcon('mazda').glyph, 'car');
  assert.equal(resolveProjectIcon('Мазда').glyph, 'car');
});

test('does not give the client tire icon to the personal Mazda project', () => {
  const mazda = resolveProjectIcon('mazda', '/home/agents/Antigravity Project/Mazda/шины');
  const tyres = resolveProjectIcon('Tyres KZ', '/home/agents/Antigravity Project/Tyres');
  assert.equal(mazda.glyph, 'car');
  assert.equal(tyres.glyph, 'tire');
  assert.notEqual(mazda.background, tyres.background);
});

test('picks a unique glyph for the live project list', () => {
  assert.equal(resolveProjectIcon('instagram').glyph, 'camera');
  assert.equal(resolveProjectIcon('insta-comments').glyph, 'message');
  assert.equal(resolveProjectIcon('insta-kill').glyph, 'ban');
  assert.equal(resolveProjectIcon('kvadrobanya-new').glyph, 'droplets');
  assert.equal(resolveProjectIcon('Помощник MAX (приставы)').glyph, 'scale');
  assert.equal(resolveProjectIcon('image-generate').glyph, 'image');
  assert.equal(resolveProjectIcon('generate').glyph, 'sparkles');
  assert.equal(resolveProjectIcon('Eurasia').glyph, 'globe');
  assert.equal(resolveProjectIcon('wisper').glyph, 'mic');
});

test('falls back to a stable color and a two-letter mark', () => {
  const first = resolveProjectIcon('Untitled folder');
  const second = resolveProjectIcon('Untitled folder');
  assert.equal(first.background, second.background);
  assert.equal(first.glyph, 'folder');
  assert.equal(first.letter, 'UF');
});

test('uses the first letter of the display name', () => {
  assert.equal(firstLetter('claude agent'), 'C');
  assert.equal(firstLetter(''), '?');
});

test('builds a two-letter monogram', () => {
  assert.equal(monogram('claude agent'), 'CA');
  assert.equal(monogram('kvadrobanya-new'), 'KN');
  assert.equal(monogram('tmp'), 'TM');
});
