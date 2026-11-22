import assert from 'node:assert/strict';
import test from 'node:test';

import { isHomeJunkProject } from '../home/homeProjectsModel.js';
import { REAL_PROJECTS } from '../home/realProjects.fixture.js';

import { NEON_GLYPHS } from './neon/neonGlyphs.js';
import { NEON_ACCENTS } from './neon/neonPalette.js';
import { resolveProjectIcon } from './projectIconSpec.js';

const REAL_PROJECTS_KEPT = REAL_PROJECTS.filter(
  ([name, path]) => !isHomeJunkProject({ projectId: path, displayName: name, fullPath: path, path }),
);
const byName = (wanted: string) => {
  const found = REAL_PROJECTS.find(([name]) => name === wanted);
  assert.ok(found, wanted);
  return resolveProjectIcon(found[0], found[1]);
};
const look = (spec: { glyph: string; accent: string }) => `${spec.glyph} ${spec.accent}`;

test('picks a tire glyph for Tyres projects', () => {
  assert.equal(resolveProjectIcon('Tyres KZ').glyph, 'tire');
  assert.equal(resolveProjectIcon('Samruk Tyres').glyph, 'tire');
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
  assert.notEqual(mazda.accent, tyres.accent);
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

test('every real non-junk project has its own table icon, never the folder fallback', () => {
  assert.equal(REAL_PROJECTS_KEPT.length, 117);
  for (const [name, path] of REAL_PROJECTS_KEPT) {
    const spec = resolveProjectIcon(name, path);
    assert.equal(spec.match, 'table', `${name} — ${path}`);
    assert.notEqual(spec.glyph, 'folder', name);
    assert.ok(spec.glyph in NEON_GLYPHS, `${name}: ${spec.glyph}`);
    assert.ok((NEON_ACCENTS as readonly string[]).includes(spec.accent), `${name}: ${spec.accent}`);
  }
});

test('the Tyres family is told apart by colour or symbol', () => {
  const family = ['Tyres KZ', 'Tyres 7su', 'Tyres KG', 'Линии Сергея', 'Tyres Bot', 'Tyres Store'].map(byName);
  assert.equal(new Set(family.map(look)).size, family.length);
  // Same folder twice in the list (Tyres-kg / tyres-kg) is one project — same icon.
  assert.equal(look(byName('Tyres KG')), look(byName('tyres-kg')));
});

test('demo and working copies differ', () => {
  assert.notEqual(look(byName('Bishkek Garden')), look(byName('Bishkek Garden Demo')));
  assert.notEqual(look(byName('Neo3 Visual')), look(byName('Neo3 Visual Share')));
  assert.notEqual(look(byName('kvadrobanya-new')), look(byName('kvadrobanya-old')));
  assert.notEqual(look(byName('Grok Bot')), look(byName('Grok Bot Friend')));
  assert.notEqual(look(byName('claude agent')), look(byName('cloudcli-fork')));
});

test('an unknown name falls back to a keyword symbol or a folder, coloured from the palette by path', () => {
  const first = resolveProjectIcon('Untitled folder', '/Users/me/Untitled folder');
  const again = resolveProjectIcon('Untitled folder', '/Users/me/Untitled folder');
  assert.deepEqual(first, again);
  assert.equal(first.glyph, 'folder');
  assert.equal(first.match, 'fallback');
  assert.ok((NEON_ACCENTS as readonly string[]).includes(first.accent));
  assert.equal('letter' in first, false, 'no letters on tiles');

  const shop = resolveProjectIcon('Обувной магазин', '/srv/shoes');
  assert.equal(shop.match, 'keyword');
  assert.equal(shop.glyph, 'cart');

  // Different paths spread over the palette instead of all sharing one colour.
  const accents = new Set(
    Array.from({ length: 40 }, (_, index) => resolveProjectIcon(`client ${index}`, `/srv/client-${index}`).accent),
  );
  assert.ok(accents.size >= 10, `only ${accents.size} colours`);
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
