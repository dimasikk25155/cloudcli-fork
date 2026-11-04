import assert from 'node:assert/strict';
import test from 'node:test';

import { createSafariLiveActions } from '@/modules/safari-live/index.js';
import type {
  EnsureDisplayResult,
  OpenWindowResult,
  PlaceResult,
  SafariBinding,
  SafariLiveService,
  SafariWindowList,
} from '@/modules/safari-live/index.js';

const WINDOWS = [
  { windowId: 120, title: 'Яндекс', onScreen: true, width: 1280, height: 800 },
  { windowId: 345, title: 'Kwork — заказы', onScreen: false, width: 1440, height: 900 },
  { windowId: 200, title: 'GitHub', onScreen: true, width: 1000, height: 700 },
];

function fixture(overrides: { list?: SafariWindowList; display?: EnsureDisplayResult; place?: PlaceResult; open?: OpenWindowResult; admin?: boolean; modOn?: boolean } = {}) {
  const calls: string[] = [];
  const stored = new Map<string, SafariBinding>();
  const notified: Array<[number, string]> = [];
  const list = overrides.list ?? { state: 'ok', windows: WINDOWS };
  const service = {
    listWindows: async () => list,
    pickWindow: async (titleContains?: string) => {
      calls.push(`pick:${titleContains ?? ''}`);
      const needle = (titleContains ?? '').toLowerCase();
      const matching = list.windows.filter((window) => window.title.trim() !== '' && window.title.toLowerCase().includes(needle));
      const window = matching.sort((a, b) => b.windowId - a.windowId)[0] ?? null;
      return { window, list };
    },
    ensureDisplay: async () => {
      calls.push('display');
      return overrides.display ?? { ok: true, bounds: { x: 2560, y: 1440, width: 1920, height: 1200 } };
    },
    placeOnDisplay: async (windowId: number) => {
      calls.push(`place:${windowId}`);
      return overrides.place ?? { ok: true };
    },
    openWindow: async (url: string, windowId?: number) => {
      calls.push(`open:${url}:${windowId ?? 'new'}`);
      return overrides.open ?? { ok: true, windowId: windowId ?? 777 };
    },
  } as unknown as SafariLiveService;
  const actions = createSafariLiveActions({
    service,
    bindings: {
      get: (sessionId) => stored.get(sessionId) ?? null,
      set: (sessionId, input) => {
        const binding = { sessionId, ...input, updatedAt: '2026-11-05T01:00:00.000Z' };
        stored.set(sessionId, binding);
        return binding;
      },
      clear: (sessionId) => { stored.delete(sessionId); },
    },
    modOn: () => overrides.modOn ?? true,
    isAdmin: () => overrides.admin ?? true,
    notify: (userId, sessionId) => { notified.push([userId, sessionId]); },
  });
  return { actions, calls, stored, notified };
}

const rejectsWith = async (promise: Promise<unknown>, status: number, text: RegExp) => {
  await assert.rejects(promise, (error: { statusCode?: number; message: string }) => {
    assert.equal(error.statusCode, status, error.message);
    assert.match(error.message, text);
    return true;
  });
};

test('safari.show without a title binds the newest window, moves it onto the display and pings the user', async () => {
  const { actions, calls, stored, notified } = fixture();
  const result = await actions.showForAgent(1, 'chat', {});
  assert.equal(result.windowId, 345);
  assert.equal(result.title, 'Kwork — заказы');
  assert.match(result.message, /«Kwork — заказы» \(windowId 345\) показано Диме справа в Neo3 вживую/);
  assert.match(result.message, /Safari вперёд не выводи и не прячь/);
  assert.deepEqual(calls, ['pick:', 'display', 'place:345']);
  assert.equal(stored.get('chat')?.windowId, 345);
  assert.equal(stored.get('chat')?.boundBy, 'agent');
  assert.deepEqual(notified, [[1, 'chat']]);
});

test('safari.show with titleContains binds the newest matching window', async () => {
  const { actions, stored } = fixture();
  const result = await actions.showForAgent(1, 'chat', { titleContains: 'яндекс' });
  assert.equal(result.windowId, 120);
  assert.equal(stored.get('chat')?.title, 'Яндекс');
});

test('safari.show refusals: non-admin 403, mod off 409, no windows / no match / no permission / not a Mac — plain texts, nothing bound', async () => {
  const cases: Array<[ReturnType<typeof fixture>, Record<string, unknown>, number, RegExp]> = [
    [fixture({ admin: false }), {}, 403, /Safari вживую доступен только администратору/],
    [fixture({ modOn: false }), {}, 409, /./],
    [fixture({ list: { state: 'ok', windows: [] } }), {}, 404, /Окон Safari нет — открой страницу в своём окне: safari\.show \{data:\{url:"<адрес>"\}\}/],
    [fixture(), { titleContains: 'нет такого' }, 404, /нет такого/],
    [fixture({ list: { state: 'no_permission', windows: [] } }), {}, 409, /Нет разрешения «Запись экрана» — скажи Диме одной строкой/],
    [fixture({ list: { state: 'unsupported', windows: [] } }), {}, 409, /только на Mac/],
  ];
  for (const [{ actions, stored, notified }, data, status, text] of cases) {
    await rejectsWith(actions.showForAgent(1, 'chat', data), status, text);
    assert.equal(stored.size, 0);
    assert.deepEqual(notified, []);
  }
  const modOff = fixture({ modOn: false });
  await assert.rejects(modOff.actions.showForAgent(1, 'chat', {}), (error: { code?: string }) => error.code === 'MOD_OFF');
});

test('safari.show: the display failed → the binding is still written and the agent is told the picture may be empty', async () => {
  const { actions, stored, notified, calls } = fixture({ display: { ok: false, state: 'error', message: 'раскладка не восстановилась' } });
  await assert.rejects(actions.showForAgent(1, 'chat', {}), (error: { message: string }) => {
    assert.match(error.message, /картинка может быть пустой/);
    assert.match(error.message, /раскладка не восстановилась/);
    return true;
  });
  assert.equal(stored.get('chat')?.windowId, 345);
  assert.deepEqual(notified, [[1, 'chat']]);
  assert.ok(!calls.some((call) => call.startsWith('place:')), 'nothing is moved without a display');
});

test('safari.show: the window closed while moving → window_gone text, nothing bound', async () => {
  const { actions, stored } = fixture({ place: { ok: false, end: 'window_gone', message: 'нет окна' } });
  await rejectsWith(actions.showForAgent(1, 'chat', {}), 404, /закрыл/);
  assert.equal(stored.size, 0);
});

test('safari.show {url}: a NEW window of the agent is opened after the display is ready, moved onto it and bound', async () => {
  const { actions, calls, stored, notified } = fixture();
  const result = await actions.showForAgent(1, 'chat', { url: 'https://example.com/a b' });
  assert.equal(result.windowId, 777);
  assert.deepEqual(calls, ['display', 'open:https://example.com/a%20b:new', 'place:777']);
  assert.equal(stored.get('chat')?.windowId, 777);
  assert.equal(stored.get('chat')?.boundBy, 'agent');
  assert.deepEqual(notified, [[1, 'chat']]);
  assert.match(result.message, /windowId:777/);
  assert.match(result.message, /Safari вперёд не выводи и не прячь/);
});

test('safari.show {windowId, url} navigates that window; {windowId} alone binds it even before its title loads', async () => {
  const list: SafariWindowList = { state: 'ok', windows: [...WINDOWS, { windowId: 500, title: '', onScreen: false, width: 1920, height: 1170 }] };
  const navigated = fixture({ list });
  const result = await navigated.actions.showForAgent(1, 'chat', { windowId: 345, url: 'https://example.org/' });
  assert.equal(result.windowId, 345);
  assert.deepEqual(navigated.calls, ['open:https://example.org/:345', 'display', 'place:345']);

  const bound = fixture({ list });
  assert.equal((await bound.actions.showForAgent(1, 'chat', { windowId: 500 })).windowId, 500);
  assert.equal(bound.stored.get('chat')?.windowId, 500);
});

test('safari.show refusals for url/windowId: bad address 400, unknown window 404, closed window 404 — nothing bound', async () => {
  const cases: Array<[ReturnType<typeof fixture>, Record<string, unknown>, number, RegExp]> = [
    [fixture(), { url: 'file:///etc/passwd' }, 400, /http/],
    [fixture(), { windowId: 'abc' }, 400, /windowId/],
    [fixture(), { windowId: 999 }, 404, /999/],
    [fixture({ open: { ok: false, state: 'error', end: 'window_gone', message: 'нет окна' } }), { windowId: 345, url: 'https://example.org/' }, 404, /закрыл/],
    [fixture({ open: { ok: false, state: 'error', message: 'Safari did not answer' } }), { url: 'https://example.org/' }, 503, /Safari did not answer/],
  ];
  for (const [{ actions, stored, notified }, data, status, text] of cases) {
    await rejectsWith(actions.showForAgent(1, 'chat', data), status, text);
    assert.equal(stored.size, 0);
    assert.deepEqual(notified, []);
  }
});

test('safari.show: only untitled service windows left → «Окон Safari нет…», also with titleContains', async () => {
  const list: SafariWindowList = { state: 'ok', windows: [{ windowId: 23531, title: '', onScreen: false, width: 500, height: 500 }] };
  await rejectsWith(fixture({ list }).actions.showForAgent(1, 'chat', {}), 404, /Окон Safari нет/);
  await rejectsWith(fixture({ list }).actions.showForAgent(1, 'chat', { titleContains: 'kwork' }), 404, /Окон Safari нет/);
});
