import assert from 'node:assert/strict';
import test from 'node:test';

import { createBridgeWatch, DOWN_AFTER_MS, REPEAT_MS, type BridgeNotice } from '@/modules/bridge/bridge-watch.js';
import type { BridgeStatus } from '@/modules/bridge/bridge.service.js';

function status(over: Partial<BridgeStatus>): BridgeStatus {
  return {
    checked_at: 0, installed: true, mode: 'auto', mode_title: 'авто', route: 'mitya', route_title: 'сервер Мити',
    route_since: 0, health_age: 5, expected_ip: '45.86.61.144', exit_ok: true, exit_ip: '45.86.61.144',
    public_tunnel: true, blocked_last_hour: 0, switches: [], level: 'green', text: '', ...over,
  };
}

function harness(on = true) {
  let clock = 1_000_000;
  let current = status({});
  const sent: BridgeNotice[] = [];
  const watch = createBridgeWatch({
    status: async () => current,
    notify: async (notice) => {
      sent.push(notice);
    },
    isOn: () => on,
    now: () => clock,
  });
  return {
    sent,
    set: (over: Partial<BridgeStatus>) => {
      current = status(over);
    },
    advance: (ms: number) => {
      clock += ms;
    },
    tick: () => watch.tick(),
  };
}

test('мост: первый проход молчит, смена пути на VPS — одно сообщение, возврат на Митю — другое', async () => {
  const h = harness();
  await h.tick();
  assert.equal(h.sent.length, 0);
  h.set({ route: 'vps-ts' });
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['switched']);
  assert.match(h.sent[0].body, /мой VPS/);
  h.set({ route: 'vps-pub' }); // внутри своего VPS — не новость
  await h.tick();
  assert.equal(h.sent.length, 1);
  h.set({ route: 'mitya' });
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['switched', 'returned']);
});

test('мост: короткий обрыв при переключении не тревожит, лёг дольше 2 минут — тревога и «снова работает»', async () => {
  const h = harness();
  await h.tick();
  h.set({ exit_ok: false, route: 'none' });
  await h.tick();
  h.advance(DOWN_AFTER_MS - 1000);
  await h.tick();
  assert.equal(h.sent.length, 0);
  h.advance(2000);
  await h.tick();
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['down']);
  h.set({ route: 'vps-ts' });
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['down', 'up']);
  assert.match(h.sent[1].body, /мой VPS/);
});

test('мост: выключенный мост — отдельное предупреждение про IP мака', async () => {
  const h = harness();
  await h.tick();
  h.set({ installed: false, exit_ok: false });
  await h.tick();
  h.advance(DOWN_AFTER_MS);
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['off']);
  assert.match(h.sent[0].body, /IP мака/);
});

test('мост: одно и то же сообщение не чаще раза в 10 минут', async () => {
  const h = harness();
  await h.tick();
  for (let i = 0; i < 3; i += 1) {
    h.set({ route: 'vps-ts' });
    await h.tick();
    h.set({ route: 'mitya' });
    await h.tick();
    h.advance(60_000);
  }
  assert.deepEqual(h.sent.map((n) => n.kind), ['switched', 'returned']);
  h.advance(REPEAT_MS);
  h.set({ route: 'vps-ts' });
  await h.tick();
  assert.deepEqual(h.sent.map((n) => n.kind), ['switched', 'returned', 'switched']);
});

test('мост: мод выключен — сторож ничего не читает и не шлёт', async () => {
  const h = harness(false);
  await h.tick();
  h.set({ route: 'vps-ts' });
  await h.tick();
  assert.equal(h.sent.length, 0);
});
