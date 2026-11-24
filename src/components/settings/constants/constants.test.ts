import assert from 'node:assert/strict';
import test from 'node:test';

import { KNOWN_MAIN_TABS, SETTINGS_MAIN_TABS, normalizeMainTab } from './constants.js';

test('openSettings(\'instruments\') открывает именно вкладку «Инструменты»', () => {
  assert.equal(normalizeMainTab('instruments'), 'instruments');
  assert.ok(KNOWN_MAIN_TABS.includes('instruments'));
});

test('прежние адреса вкладок не поменялись', () => {
  // «tools» — старое имя «Агентов» и значение по умолчанию у openSettings().
  assert.equal(normalizeMainTab('tools'), 'agents');
  assert.equal(normalizeMainTab('appearance'), 'appearance');
  assert.equal(normalizeMainTab('нет-такой'), 'agents');
});

test('«Инструменты» находятся в палитре команд, в том числе по словам из бывшего «Меню»', () => {
  const tab = SETTINGS_MAIN_TABS.find((item) => item.id === 'instruments');
  assert.ok(tab, 'вкладка есть в списке палитры');
  assert.equal(tab.label, 'Инструменты');
  for (const word of ['меню', 'расписания', 'канцелярия', 'сервер']) {
    assert.ok(tab.keywords.includes(word), word);
  }
});
