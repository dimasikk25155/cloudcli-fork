import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarMenuItems, { type SidebarMenuItem } from './SidebarMenuItems';

// The owner's full menu, as the old mobile row listed it (spec R07i).
const LABELS: Array<[string, string]> = [
  ['nightshift', 'Системные задачи'],
  ['consigliere', 'Канцелярия'],
  ['mazda', 'Мазда'],
  ['agent-workspace', 'Рабочее пространство'],
  ['schedules', 'Расписания'],
  ['pipelines', 'Сценарии'],
  ['governance', 'Аудит и деньги'],
  ['server', 'Сервер'],
  ['duet', 'Дуэт'],
  ['agents', 'Агенты'],
  ['queue', 'Конвейер'],
  ['krabik', 'Агент крабик'],
  ['settings', 'Настройки'],
];
const items: SidebarMenuItem[] = LABELS.map(([key, label]) => ({ key, label, onClick: () => {} }));

const render = (variant: 'list' | 'grid', overdueCount = 0, list = items) =>
  renderToStaticMarkup(React.createElement(SidebarMenuItems, { items: list, variant, overdueCount }));

const buttons = (html: string) => html.split('<button').slice(1);

test('grid: four columns of big tiles with the whole label, in menu order', () => {
  const html = render('grid');
  assert.match(html, /class="[^"]*\bgrid grid-cols-4\b/);
  const parts = buttons(html);
  assert.equal(parts.length, 13);
  const labels = parts.map((part) => part.match(/aria-label="([^"]+)"/)?.[1]);
  assert.deepEqual(labels, LABELS.map(([, label]) => label));
  for (const [index, part] of parts.entries()) {
    assert.match(part, /h-\[3\.25rem\] w-\[3\.25rem\]/, 'lg tile');
    assert.match(part, new RegExp(`>${LABELS[index][1]}</span>`), 'full label, not a short one');
  }
  assert.match(html, /line-clamp-2/);
  assert.doesNotMatch(html, /\btruncate\b/);
});

// iPhone 375: drawer 85vw ≈ 319 px, «Меню» px-2 → 302 px over 4 columns. With
// the old grid px-1 + gap-x-1 + button px-0.5 a label got ≈ 66 px, and
// «пространство» (≈ 69–72 px at 11 px in SF/Geologica) clamped to «…».
test('grid: a label gets the whole column, 10.5 px, Russian hyphenation as a fallback', () => {
  const html = render('grid');
  const grid = html.match(/^<div class="([^"]+)"/)?.[1] ?? '';
  assert.match(grid, /\bgap-x-0\.5\b/);
  assert.doesNotMatch(grid, /\bpx-/, 'no side padding on the grid');
  for (const part of buttons(html)) {
    const button = part.match(/class="([^"]+)"/)?.[1] ?? '';
    assert.match(button, /\bpx-0\b/, 'no side padding on the tile button');
    const label = part.match(/<span lang="ru" class="([^"]+)">[^<]+<\/span>/)?.[1];
    assert.ok(label, 'label marked lang="ru" so hyphens can split «простран-ство»');
    assert.match(label, /\btext-\[10\.5px\]/);
    assert.match(label, /\bhyphens-auto\b/);
    assert.match(label, /\bline-clamp-2\b/);
  }
});

test('list: the desktop rows keep the full label next to a small tile', () => {
  const html = render('list');
  const parts = buttons(html);
  assert.equal(parts.length, 13);
  for (const [index, part] of parts.entries()) {
    assert.match(part, /sidebar-footer-item/);
    assert.match(part, /\bh-7 w-7\b/, 'sm tile');
    assert.match(part, new RegExp(`>${LABELS[index][1]}</span>`));
  }
  assert.doesNotMatch(html, /grid-cols-4/);
});

test('every known key gets its own drawn tile, the crab included', () => {
  const html = render('grid');
  assert.equal((html.match(/data-menu-tile="/g) ?? []).length, 13);
  assert.equal((html.match(/data-menu-icon="/g) ?? []).length, 12);
  assert.match(html, /class="crab /);
});

test('the overdue count sits on the Канцелярия tile in both shapes', () => {
  for (const variant of ['grid', 'list'] as const) {
    const parts = buttons(render(variant, 4));
    const withDot = parts.filter((part) => /bg-rose-600[^>]*>4</.test(part));
    assert.equal(withDot.length, 1, variant);
    assert.match(withDot[0], /aria-label="Канцелярия"|>Канцелярия</);
  }
  assert.doesNotMatch(render('grid', 0), /bg-rose-600/);
});

test('an entry without a drawn icon gets a neutral tile with its first letter', () => {
  const html = render('grid', 0, [{ key: 'telegram', label: 'Телеграм', onClick: () => {} }]);
  assert.doesNotMatch(html, /data-menu-tile=/);
  assert.match(html, /neo3-squircle/);
  assert.match(html, />Т</);
  assert.match(html, />Телеграм</);
});
