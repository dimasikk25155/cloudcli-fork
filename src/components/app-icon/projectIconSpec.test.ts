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

test('a project inside the Neo3 or home folder does not inherit that folder icon', () => {
  assert.equal(resolveProjectIcon('foo', '/root/cloudcli/foo').glyph, 'folder');
  assert.equal(resolveProjectIcon('foo', '/Users/x/claude agent/foo').glyph, 'folder');
  assert.equal(resolveProjectIcon('bar', '/Users/dimasik/bar').glyph, 'folder');
});

test('Neo3 itself gets its own mark, not a smiley', () => {
  assert.equal(resolveProjectIcon('claude agent', '/Users/dimasik/Antigravity Project/claude agent').glyph, 'neo3');
  assert.equal(resolveProjectIcon('Neo3', '/srv/cloudcli-fork').glyph, 'neo3');
  assert.equal(resolveProjectIcon('neo3-hub').glyph, 'neo3');
});

test('the folder name counts, Windows separators too', () => {
  assert.equal(resolveProjectIcon('My car', '/home/me/mazda').glyph, 'car');
  assert.equal(resolveProjectIcon('Shop', 'C:\\work\\tyres-kz\\').glyph, 'tire');
});

test('common words give a friend project its own icon', () => {
  assert.equal(resolveProjectIcon('Oldi_film_production', '/root/Oldi_film_production').glyph, 'clapper');
  assert.equal(resolveProjectIcon('Видео для клиента').glyph, 'clapper');
  assert.equal(resolveProjectIcon('Reels MAKE', '/root/Reels MAKE').glyph, 'play');
  assert.equal(resolveProjectIcon('tiktok-shorts').glyph, 'play');
  assert.equal(resolveProjectIcon('WABA_manager', '/root/WABA_manager').glyph, 'message');
  assert.equal(resolveProjectIcon('support bot').glyph, 'message');
  assert.equal(resolveProjectIcon('мой бот').glyph, 'message');
  assert.equal(resolveProjectIcon('robotics').glyph, 'folder');
});

test('the new word rules never beat an older preset', () => {
  assert.equal(resolveProjectIcon('insta-comments bot').glyph, 'message');
  assert.equal(resolveProjectIcon('karaoke video').glyph, 'music');
  assert.equal(resolveProjectIcon('neo3-demo video').glyph, 'play');
});
