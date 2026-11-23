import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SettingsRow from './SettingsRow.js';
import SettingsToggle from './SettingsToggle.js';

const html = (child: React.ReactNode, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(SettingsRow, { label: 'Тема', description: 'Описание', children: child, ...props }),
  );

test('широкий элемент (список, кнопка) на телефоне уходит под текст, текст занимает всю ширину', () => {
  const out = html(React.createElement('select', null));
  assert.match(out, /data-row-layout="stacked"/);
  // колонка до md, ряд с md
  assert.match(out, /flex-col/);
  assert.match(out, /md:flex-row/);
  // обёртка элемента не сжимает текст только на широком экране
  assert.match(out, /md:flex-shrink-0/);
  assert.doesNotMatch(out, /class="[^"]*(?<![:\w-])flex-shrink-0/);
});

test('компактный переключатель остаётся в одном ряду с текстом', () => {
  const out = html(
    React.createElement(SettingsToggle, { checked: false, onChange: () => undefined, ariaLabel: 'x' }),
  );
  assert.match(out, /data-row-layout="inline"/);
  assert.doesNotMatch(out, /flex-col/);
});

test('раскладку можно задать явно', () => {
  assert.match(html(React.createElement('select', null), { layout: 'inline' }), /data-row-layout="inline"/);
  assert.match(
    html(React.createElement(SettingsToggle, { checked: true, onChange: () => undefined, ariaLabel: 'x' }), {
      layout: 'stacked',
    }),
    /data-row-layout="stacked"/,
  );
});

test('на телефоне список или кнопка под текстом — шириной со своё содержимое, а не во весь блок', () => {
  const out = html(React.createElement('select', { className: 'w-full' }));
  // Обёртка элемента управления — последний div строки.
  const wrapper = /<div class="([^"]*)"><select/.exec(out)?.[1].split(/\s+/) ?? [];
  // В колонке блок по умолчанию растягивается на всю ширину; self-start
  // оставляет ему ширину содержимого.
  assert.ok(wrapper.includes('self-start'), wrapper.join(' '));
  // Разумный минимум — как ширина списка на компьютере (11rem), но не шире строки.
  assert.ok(wrapper.includes('min-w-[min(11rem,100%)]'), wrapper.join(' '));
  assert.ok(wrapper.includes('max-w-full'), 'длинное содержимое не вылезает за строку');
  // На компьютере — как было: справа от текста, без минимума.
  for (const name of ['md:self-auto', 'md:min-w-0', 'md:flex-shrink-0']) {
    assert.ok(wrapper.includes(name), name);
  }
});

test('переключателю минимум ширины не навязывается', () => {
  const out = html(
    React.createElement(SettingsToggle, { checked: false, onChange: () => undefined, ariaLabel: 'x' }),
  );
  assert.doesNotMatch(out, /min-w-\[min\(11rem,100%\)\]/);
});
