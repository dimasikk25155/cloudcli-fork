import assert from 'node:assert/strict';
import test from 'node:test';

import type { SafariLiveView } from '../../types/app.js';

import {
  SAFARI_STATE_TEXT,
  markSafariAutoOpened,
  panelStateFor,
  safariBindingKey,
  shouldAutoOpenSafari,
  visibleSafariWindows,
  wasSafariAutoOpened,
} from './safariLiveModel.js';

const win = (windowId: number, title: string) => ({ windowId, title, onScreen: true, width: 1280, height: 800 });
const binding = { sessionId: 's1', windowId: 7, title: 'Сайт', boundBy: 'agent' as const, updatedAt: '2026-11-05T01:00:00Z' };
const view = (extra: Partial<SafariLiveView> = {}): SafariLiveView => ({
  state: 'ok', binding, windowAlive: true, streamUrl: '/sl/t/stream', windows: [win(7, 'Сайт')], ...extra,
});
const on = { isActive: true, modOn: true };

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test('привязанное живое окно на виду — «Вживую», не на виду — «Пауза»', () => {
  assert.equal(panelStateFor(view(), on), 'live');
  assert.equal(panelStateFor(view(), { ...on, isActive: false }), 'paused');
});

test('мод выключен важнее всего; пока ответа нет — загрузка', () => {
  assert.equal(panelStateFor(view(), { ...on, modOn: false }), 'mod_off');
  assert.equal(panelStateFor(null, on), 'loading');
});

test('состояния сервера: нет разрешения, не Mac, ошибка помощника', () => {
  assert.equal(panelStateFor(view({ state: 'no_permission', streamUrl: null }), on), 'no_permission');
  assert.equal(panelStateFor(view({ state: 'unsupported', streamUrl: null }), on), 'unsupported');
  assert.equal(panelStateFor(view({ state: 'error', streamUrl: null }), on), 'error');
});

test('нет привязки: окон нет → «Окон нет», окна есть → выбор; служебное окно без заголовка не считается', () => {
  assert.equal(panelStateFor(view({ binding: null, streamUrl: null, windows: [] }), on), 'no_windows');
  assert.equal(panelStateFor(view({ binding: null, streamUrl: null, windows: [win(1, '')] }), on), 'no_windows');
  assert.equal(panelStateFor(view({ binding: null, streamUrl: null, windows: [win(2, 'A')] }), on), 'pick');
});

test('окно закрыто, и обрыв потока после переподписки', () => {
  assert.equal(panelStateFor(view({ windowAlive: false, streamUrl: null }), on), 'window_gone');
  assert.equal(panelStateFor(view(), { ...on, streamBroken: true }), 'error');
});

test('список окон прячет окна без заголовка', () => {
  assert.deepEqual(visibleSafariWindows([win(1, ''), win(2, '  '), win(3, 'Сайт')]).map((w) => w.windowId), [3]);
});

test('у каждого состояния есть русский текст; «Вживую» и «Пауза» — по спецификации', () => {
  assert.equal(SAFARI_STATE_TEXT.live, 'Вживую');
  assert.equal(SAFARI_STATE_TEXT.paused, 'Пауза — вкладка не на виду');
  assert.equal(SAFARI_STATE_TEXT.window_gone, 'Окно закрыто — выбери другое');
  assert.match(SAFARI_STATE_TEXT.no_windows, /^Окон Safari нет/);
  assert.match(SAFARI_STATE_TEXT.no_permission, /Запись экрана/);
  assert.equal(SAFARI_STATE_TEXT.mod_off, 'Мод выключен');
  assert.equal(SAFARI_STATE_TEXT.unsupported, 'Только на Mac');
  assert.equal(SAFARI_STATE_TEXT.error, 'Связь с картинкой прервалась');
});

test('ключ привязки меняется вместе с окном и временем привязки', () => {
  const a = safariBindingKey('s1', { windowId: 7, updatedAt: 'T1' });
  assert.notEqual(a, safariBindingKey('s1', { windowId: 8, updatedAt: 'T1' }));
  assert.notEqual(a, safariBindingKey('s1', { windowId: 7, updatedAt: 'T2' }));
  assert.notEqual(a, safariBindingKey('s2', { windowId: 7, updatedAt: 'T1' }));
});

test('автооткрытие: один раз на привязку, не на телефоне, только админу при включённых модах', () => {
  const base = { isMobile: false, workbenchOn: true, modOn: true, isAdmin: true, bindingKey: 'k', alreadyOpened: false };
  assert.equal(shouldAutoOpenSafari(base), true);
  assert.equal(shouldAutoOpenSafari({ ...base, isMobile: true }), false);
  assert.equal(shouldAutoOpenSafari({ ...base, workbenchOn: false }), false);
  assert.equal(shouldAutoOpenSafari({ ...base, modOn: false }), false);
  assert.equal(shouldAutoOpenSafari({ ...base, isAdmin: false }), false);
  assert.equal(shouldAutoOpenSafari({ ...base, bindingKey: null }), false);
  assert.equal(shouldAutoOpenSafari({ ...base, alreadyOpened: true }), false);
});

test('память автооткрытия хранит последние 50 ключей', () => {
  const storage = memoryStorage();
  assert.equal(wasSafariAutoOpened('k1', storage), false);
  markSafariAutoOpened('k1', storage);
  assert.equal(wasSafariAutoOpened('k1', storage), true);
  for (let i = 0; i < 60; i += 1) markSafariAutoOpened(`n${i}`, storage);
  assert.equal(wasSafariAutoOpened('k1', storage), false);
  assert.equal(wasSafariAutoOpened('n59', storage), true);
  assert.equal(JSON.parse(storage.getItem('neo3.safariLive.autoOpened') ?? '[]').length, 50);
});
