import assert from 'node:assert/strict';
import test from 'node:test';

import type { SafariLiveView } from '../../types/app.js';

import {
  STREAM_RECOVERY_START,
  STREAM_STABLE_MS,
  SAFARI_STATE_TEXT,
  keyboardEventToInput,
  nextStreamRecovery,
  pointerToPagePoint,
  shouldSendMove,
  wheelToScrollDy,
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

// ---- Браузер: ввод Димы («Управлять») ----

test('координаты: картинка вписана по ширине и прижата к верху — поле только снизу', () => {
  // Блок 640×600, кадр 1280×800 → кадр 640×400 у верха, ниже пустое поле.
  const box = { width: 640, height: 600 };
  const natural = { width: 1280, height: 800 };
  assert.deepEqual(pointerToPagePoint({ x: 320, y: 200 }, box, natural), { x: 640, y: 400 });
  assert.deepEqual(pointerToPagePoint({ x: 0, y: 0 }, box, natural), { x: 0, y: 0 });
  assert.deepEqual(pointerToPagePoint({ x: 640, y: 400 }, box, natural), { x: 1280, y: 800 });
  assert.equal(pointerToPagePoint({ x: 100, y: 450 }, box, natural), null);
});

test('координаты: узкий кадр вписан по высоте — поля слева и справа, сверху нет', () => {
  // Блок 1000×400, кадр 1280×800 → масштаб 0.5, кадр 640×400, поля по 180.
  const box = { width: 1000, height: 400 };
  const natural = { width: 1280, height: 800 };
  assert.equal(pointerToPagePoint({ x: 100, y: 100 }, box, natural), null);
  assert.equal(pointerToPagePoint({ x: 830, y: 100 }, box, natural), null);
  assert.deepEqual(pointerToPagePoint({ x: 180, y: 0 }, box, natural), { x: 0, y: 0 });
  assert.deepEqual(pointerToPagePoint({ x: 500, y: 200 }, box, natural), { x: 640, y: 400 });
});

test('координаты: кадр меньше страницы (сжатый) масштабируется к 1280×800; clamp прижимает к краю', () => {
  const box = { width: 640, height: 400 };
  const natural = { width: 640, height: 400 };
  assert.deepEqual(pointerToPagePoint({ x: 160, y: 100 }, box, natural), { x: 320, y: 200 });
  assert.deepEqual(pointerToPagePoint({ x: 700, y: -20 }, box, natural, { clamp: true }), { x: 1280, y: 0 });
  assert.equal(pointerToPagePoint({ x: 700, y: -20 }, box, natural), null);
  assert.equal(pointerToPagePoint({ x: 10, y: 10 }, { width: 0, height: 0 }, natural), null);
  assert.equal(pointerToPagePoint({ x: 10, y: 10 }, box, { width: 0, height: 0 }), null);
});

test('клавиши: печатные символы — text, служебные — key, остальное — ничего', () => {
  const k = (key: string, extra = {}) => keyboardEventToInput({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  assert.deepEqual(k('a'), { kind: 'text', text: 'a' });
  assert.deepEqual(k('Я'), { kind: 'text', text: 'Я' });
  assert.deepEqual(k(' '), { kind: 'text', text: ' ' });
  assert.deepEqual(k('A', { shiftKey: true }), { kind: 'text', text: 'A' });
  for (const key of ['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
    assert.deepEqual(k(key), { kind: 'key', key });
  }
  assert.equal(k('Shift'), null);
  assert.equal(k('F5'), null);
  assert.equal(k('Dead'), null);
  assert.equal(k('r', { metaKey: true }), null);
  assert.equal(k('c', { ctrlKey: true }), null);
});

test('колесо: строки и страницы приводятся к пикселям и ограничиваются', () => {
  assert.equal(wheelToScrollDy(120, 0), 120);
  assert.equal(wheelToScrollDy(3, 1), 48);
  assert.equal(wheelToScrollDy(1, 2), 800);
  assert.equal(wheelToScrollDy(99999, 0), 2000);
  assert.equal(wheelToScrollDy(-99999, 0), -2000);
  assert.equal(wheelToScrollDy(0.2, 0), 0);
});

test('move не чаще ~20 раз в секунду', () => {
  assert.equal(shouldSendMove(null, 1000), true);
  assert.equal(shouldSendMove(1000, 1030), false);
  assert.equal(shouldSendMove(1000, 1050), true);
});

test('состояние «выгружен»: привязка есть, поток открывается и поднимает страницу', () => {
  const unloaded = view({ state: 'unloaded', windowAlive: false, windows: [] });
  assert.equal(panelStateFor(unloaded, on), 'unloaded');
  assert.equal(panelStateFor(unloaded, { ...on, isActive: false }), 'paused');
  assert.equal(SAFARI_STATE_TEXT.unloaded, 'Браузер выгружен — открою последнюю страницу');
  assert.equal(panelStateFor(view({ state: 'unloaded', windowAlive: false, streamUrl: null }), on), 'window_gone');
});
