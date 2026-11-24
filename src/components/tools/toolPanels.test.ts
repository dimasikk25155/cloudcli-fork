import assert from 'node:assert/strict';
import test from 'node:test';

import { isMenuIconKey } from '../menu-icons/menuIconModel.js';

import {
  TOOL_PANELS,
  canOpenToolPanel,
  isToolPanelKey,
  toolPanelFromNavigateMessage,
  toolPanelFromQuery,
  visibleToolPanels,
} from './toolPanels.js';

const ALL_KEYS = [
  'nightshift',
  'consigliere',
  'mazda',
  'agent-workspace',
  'schedules',
  'pipelines',
  'governance',
  'server',
  'duet',
  'agents',
  'queue',
  'krabik',
];
const EVERYONE = ['nightshift', 'consigliere', 'mazda', 'agent-workspace', 'schedules', 'pipelines', 'governance'];
const ALL_MODS = { modDuet: true, modAgents: true, modAgentQueue: true, modKrabikAgent: true };

const keys = (isOwner: boolean, mods: Record<string, boolean>) =>
  visibleToolPanels({ isOwner, mods }).map((panel) => panel.key);

test('двенадцать экранов бывшего «Меню», в прежнем порядке и с прежними названиями', () => {
  assert.deepEqual(TOOL_PANELS.map((panel) => panel.key), ALL_KEYS);
  assert.deepEqual(TOOL_PANELS.map((panel) => panel.label), [
    'Системные задачи',
    'Канцелярия',
    'Мазда',
    'Рабочее пространство',
    'Расписания',
    'Сценарии',
    'Аудит и деньги',
    'Сервер',
    'Дуэт',
    'Агенты',
    'Конвейер',
    'Агент крабик',
  ]);
});

test('у каждого экрана написано, для чего он, и есть свой значок', () => {
  for (const panel of TOOL_PANELS) {
    assert.ok(panel.purpose.trim().length >= 20, `${panel.key}: «для чего» — фраза, а не слово`);
    assert.notEqual(panel.purpose.trim(), panel.label, `${panel.key}: «для чего» не повторяет название`);
    assert.ok(isMenuIconKey(panel.iconKey), `${panel.key}: значок из набора меню`);
  }
  assert.equal(new Set(TOOL_PANELS.map((panel) => panel.purpose)).size, 12, 'фразы разные');
});

test('не-владелец видит семь экранов, какие бы моды ни были включены', () => {
  assert.deepEqual(keys(false, ALL_MODS), EVERYONE);
  assert.deepEqual(keys(false, {}), EVERYONE);
});

test('владелец видит ещё «Сервер» и экраны включённых модов', () => {
  assert.deepEqual(keys(true, ALL_MODS), ALL_KEYS);
  assert.deepEqual(keys(true, { modDuet: false, modAgents: false, modAgentQueue: false, modKrabikAgent: false }), [...EVERYONE, 'server']);
  assert.deepEqual(keys(true, { ...ALL_MODS, modDuet: false }), ALL_KEYS.filter((key) => key !== 'duet'));
  assert.deepEqual(keys(true, { ...ALL_MODS, modKrabikAgent: false }), ALL_KEYS.filter((key) => key !== 'krabik'));
});

test('«Конвейер» есть только вместе с «Агентами»', () => {
  assert.deepEqual(
    keys(true, { ...ALL_MODS, modAgents: false }),
    ALL_KEYS.filter((key) => key !== 'agents' && key !== 'queue'),
  );
  assert.deepEqual(keys(true, { ...ALL_MODS, modAgentQueue: false }), ALL_KEYS.filter((key) => key !== 'queue'));
});

test('ключ экрана узнаётся; чужие строки и «настройки» — не экраны', () => {
  for (const key of ALL_KEYS) assert.equal(isToolPanelKey(key), true, key);
  for (const other of ['settings', 'attention', 'tools', '', null, undefined, 7]) {
    assert.equal(isToolPanelKey(other), false, String(other));
  }
});

test('открыть можно только то, что человек видит в списке', () => {
  assert.equal(canOpenToolPanel('schedules', { isOwner: false, mods: {} }), true);
  assert.equal(canOpenToolPanel('server', { isOwner: false, mods: ALL_MODS }), false);
  assert.equal(canOpenToolPanel('server', { isOwner: true, mods: {} }), true);
  assert.equal(canOpenToolPanel('queue', { isOwner: true, mods: { ...ALL_MODS, modAgents: false } }), false);
  assert.equal(canOpenToolPanel('krabik', { isOwner: true, mods: ALL_MODS }), true);
});

test('ссылка ?panel=<ключ> открывает любой из двенадцати экранов', () => {
  for (const key of ALL_KEYS) {
    assert.equal(toolPanelFromQuery(`?panel=${key}`), key);
    assert.equal(toolPanelFromQuery(`?foo=1&panel=${key}`), key);
  }
  // «Ждут тебя» — не экран инструментов, его открывает шторка.
  assert.equal(toolPanelFromQuery('?panel=attention'), null);
  assert.equal(toolPanelFromQuery('?panel=settings'), null);
  assert.equal(toolPanelFromQuery(''), null);
});

test('нажатие на уведомление в открытом окне открывает тот же набор экранов, что и ссылка', () => {
  for (const key of ALL_KEYS) {
    assert.equal(toolPanelFromNavigateMessage({ type: 'notification:navigate', panel: key }), key);
  }
  assert.equal(toolPanelFromNavigateMessage({ type: 'notification:navigate', panel: 'attention' }), null);
  assert.equal(toolPanelFromNavigateMessage({ type: 'notification:navigate', sessionId: 's-1' }), null);
  assert.equal(toolPanelFromNavigateMessage({ type: 'other', panel: 'server' }), null);
  assert.equal(toolPanelFromNavigateMessage(null), null);
  assert.equal(toolPanelFromNavigateMessage('server'), null);
});
