import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import BottomBar from './BottomBar.js';

const noop = () => undefined;

const render = (props: Partial<React.ComponentProps<typeof BottomBar>> = {}) =>
  renderToStaticMarkup(
    React.createElement(BottomBar, {
      isMobile: true,
      isHome: true,
      drawerOpen: false,
      query: '',
      onQueryChange: noop,
      searchOpen: false,
      onSearchOpenChange: noop,
      attentionCount: 0,
      onGoHome: noop,
      onOpenProjects: noop,
      onNewChat: noop,
      onOpenSettings: noop,
      ...props,
    }),
  );

const items = (html: string) => [...html.matchAll(/<button[^>]*data-bottom-bar-item="([^"]+)"[^>]*>/g)];
const item = (html: string, key: string) => items(html).find((match) => match[1] === key)?.[0] ?? '';
const classesOf = (tag: string) => new Set(/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/));
const rootTag = (html: string) => /<nav[^>]*data-bottom-bar[^>]*>/.exec(html)?.[0] ?? '';

test('на «Домой» телефона: пять кнопок в порядке из брифа, у каждой подпись для чтения с экрана', () => {
  const html = render();
  assert.deepEqual(items(html).map((match) => match[1]), ['home', 'projects', 'search', 'new-chat', 'settings']);
  const labels = items(html).map((match) => /aria-label="([^"]+)"/.exec(match[0])?.[1]);
  assert.deepEqual(labels, ['Домой', 'Проекты', 'Поиск', 'Новый чат', 'Настройки']);
});

test('в открытом чате и на компьютере панели нет в разметке', () => {
  assert.equal(render({ isHome: false, drawerOpen: false }), '');
  assert.equal(render({ isMobile: false }), '');
  assert.equal(render({ isMobile: false, isHome: false, drawerOpen: true }), '');
});

test('панель прибита к низу экрана без fixed inset-0 и стоит над шторкой', () => {
  const root = classesOf(rootTag(render()));
  for (const name of ['fixed', 'inset-x-0', 'z-[60]']) assert.ok(root.has(name), name);
  // `body.pwa-mode .fixed.inset-0` сдвигает всё с этой парой классов.
  assert.ok(!root.has('inset-0'), 'нет inset-0');
  // Низ — над клавиатурой, когда печатают в поиске панели.
  assert.ok(root.has('bottom-[var(--keyboard-height,0px)]'), 'низ следует за клавиатурой');
});

test('стекло — только готовыми классами: круглые кнопки, пилюля поиска, залитый «новый чат»', () => {
  const html = render();
  for (const key of ['home', 'projects', 'settings']) {
    assert.ok(classesOf(item(html, key)).has('glass-button'), `${key}: круглая стеклянная кнопка 44×44`);
  }
  assert.ok(classesOf(item(html, 'search')).has('glass-pill'), 'поиск — пилюля');
  assert.ok(classesOf(item(html, 'new-chat')).has('glass-button-primary'), 'новый чат залит акцентом');
  assert.doesNotMatch(html, /backdrop-blur|backdrop-filter/);
});

test('подсвечен пункт, на котором человек: «Домой» на главной, «Проекты» в шторке', () => {
  const home = render();
  assert.ok(classesOf(item(home, 'home')).has('glass-active'));
  assert.match(item(home, 'home'), /aria-current="page"/);
  assert.ok(!classesOf(item(home, 'projects')).has('glass-active'));

  const drawer = render({ isHome: false, drawerOpen: true });
  assert.ok(classesOf(item(drawer, 'projects')).has('glass-active'));
  assert.ok(!classesOf(item(drawer, 'home')).has('glass-active'));
  assert.doesNotMatch(item(drawer, 'home'), /aria-current/);
});

test('поиск раскрыт: вместо пяти кнопок поле на всю ширину с крестиком', () => {
  const html = render({ searchOpen: true, query: 'shop' });
  assert.deepEqual(items(html).map((match) => match[1]), []);
  const input = /<input[^>]*data-bottom-bar-search[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(input, /value="shop"/);
  assert.match(input, /type="search"/);
  // 16 px и больше: иначе айфон приближает страницу при фокусе.
  assert.ok(classesOf(input).has('text-base'), 'шрифт поля не меньше 16 px');
  const close = /<button[^>]*data-bottom-bar-search-close[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(close, /aria-label="Закрыть поиск"/);
  // Поле остаётся и при открытой клавиатуре: панель прячет только чужая клавиатура.
  assert.match(rootTag(html), /data-bottom-bar="search"/);
});

test('счётчик «Канцелярии» стоит на кнопке настроек и попадает в её подпись', () => {
  assert.doesNotMatch(render(), /data-attention-count/);
  const html = render({ attentionCount: 4 });
  const settings = html.slice(html.indexOf('data-bottom-bar-item="settings"'));
  assert.match(settings.slice(0, settings.indexOf('</button>')), /data-attention-count="4"/);
  assert.match(item(html, 'settings'), /aria-label="Настройки, Канцелярия: 4"/);
});
