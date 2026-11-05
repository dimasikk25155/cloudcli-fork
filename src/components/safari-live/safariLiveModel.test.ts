import assert from 'node:assert/strict';
import test from 'node:test';

import type { SafariLiveView } from '../../types/app.js';

import {
  STREAM_RECOVERY_START,
  STREAM_STABLE_MS,
  SAFARI_STATE_TEXT,
  nextStreamRecovery,
  streamUrlEvent,
  markSafariAutoOpened,
  panelStateFor,
  safariBindingKey,
  shouldAutoOpenSafari,
  visibleSafariWindows,
  wasSafariAutoOpened,
} from './safariLiveModel.js';

const win = (id: number, title: string) => ({ pageId: `p${id}`, title, url: `https://example.com/${id}`, width: 1280, height: 800 });
const binding = { sessionId: 's1', pageId: 'p7', url: 'https://example.com/7', title: 'Сайт', boundBy: 'agent' as const, updatedAt: '2026-11-05T01:00:00Z' };
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
  assert.deepEqual(visibleSafariWindows([win(1, ''), win(2, '  '), win(3, 'Сайт')]).map((w) => w.pageId), ['p3']);
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
  const a = safariBindingKey('s1', { pageId: 'p7', updatedAt: 'T1' });
  assert.notEqual(a, safariBindingKey('s1', { pageId: 'p8', updatedAt: 'T1' }));
  assert.notEqual(a, safariBindingKey('s1', { pageId: 'p7', updatedAt: 'T2' }));
  assert.notEqual(a, safariBindingKey('s2', { pageId: 'p7', updatedAt: 'T1' }));
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

test('stream recovery: every break after a recovery gets its own resubscribe in 2 s; a second break without recovery is final', () => {
  let state = STREAM_RECOVERY_START;
  state = nextStreamRecovery(state, 'break', 1_000);
  assert.equal(state.phase, 'waiting', 'first break → wait 2 s, then resubscribe');
  state = nextStreamRecovery(state, 'break', 1_100);
  assert.equal(state.phase, 'waiting', 'a repeated error while waiting changes nothing');
  state = nextStreamRecovery(state, 'resubscribed', 3_000);
  assert.equal(state.phase, 'retried');
  state = nextStreamRecovery(state, 'recovered', 3_500);
  assert.equal(state.phase, 'ok', 'the new picture arrived');
  state = nextStreamRecovery(state, 'break', 60_000);
  assert.equal(state.phase, 'waiting', 'a new break after recovery → one more resubscribe (review F1)');
  state = nextStreamRecovery(state, 'resubscribed', 62_000);
  state = nextStreamRecovery(state, 'break', 62_500);
  assert.equal(state.phase, 'broken', 'broke again before any picture → «Связь прервалась» + «Повторить»');
  assert.equal(nextStreamRecovery(state, 'break', 63_000).phase, 'broken');
  assert.equal(nextStreamRecovery(state, 'reset', 64_000).phase, 'ok', '«Повторить», another window, the tab back on view');
});

test('stream recovery: a resubscribed stream that lived long enough counts as recovered even if the browser fired no load', () => {
  let state = nextStreamRecovery(STREAM_RECOVERY_START, 'break', 0);
  state = nextStreamRecovery(state, 'resubscribed', 2_000);
  assert.equal(nextStreamRecovery(state, 'break', 2_000 + STREAM_STABLE_MS - 1).phase, 'broken');
  assert.equal(nextStreamRecovery(state, 'break', 2_000 + STREAM_STABLE_MS).phase, 'waiting');
});

test('streamUrlEvent: a new link for the same binding that the tab did not ask for = the server ended the picture', () => {
  const a = { url: '/sl/a/stream', bindingKey: 's1::7::t1' };
  assert.equal(streamUrlEvent(null, a, false), null, 'first load');
  assert.equal(streamUrlEvent(a, a, false), null, 'nothing changed');
  assert.equal(streamUrlEvent(a, { ...a, url: '/sl/b/stream' }, false), 'break', 'pinged after the stream ended');
  assert.equal(streamUrlEvent(a, { ...a, url: '/sl/b/stream' }, true), null, 'our own resubscribe / «Повторить»');
  assert.equal(streamUrlEvent(a, { url: '/sl/c/stream', bindingKey: 's1::9::t2' }, false), 'reset', 'another window bound');
  assert.equal(streamUrlEvent(a, { ...a, url: null }, false), null, 'window gone → the tab shows «Окно закрыто», not a resubscribe');
});

test('panelStateFor: a pending resubscribe shows loading, not a dead picture', () => {
  assert.equal(panelStateFor(view(), { isActive: true, modOn: true, reconnecting: true }), 'loading');
  assert.equal(panelStateFor(view({ windowAlive: false, streamUrl: null }), { isActive: true, modOn: true, reconnecting: true }), 'window_gone');
});
