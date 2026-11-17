import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { createBridgeRouter } from '@/modules/bridge/bridge.routes.js';
import { createBridgeService, type BridgeExec } from '@/modules/bridge/bridge.service.js';

const QUICK = JSON.stringify({ installed: true, exit_ok: true, route: 'mitya', level: 'green', text: 'Работает' });

test('пульт моста: execFile получает только фиксированные аргументы, мусорный вывод не роняет', async () => {
  const calls: string[][] = [];
  const exec: BridgeExec = async (args) => {
    calls.push(args);
    if (args[0] === 'json') return { code: 0, stdout: `шум\n${QUICK}\n` };
    if (args[0] === 'use') return { code: 0, stdout: JSON.stringify({ ok: true, message: 'Готово', status: null }) };
    return { code: 1, stdout: 'не JSON' };
  };
  const service = createBridgeService(exec);
  assert.equal((await service.status())?.route, 'mitya');
  assert.deepEqual(calls[0], ['json', '--quick']);
  assert.equal((await service.act('vps')).ok, true);
  assert.deepEqual(calls[1], ['use', 'vps', '--json']);
  const broken = await service.act('fix');
  assert.equal(broken.ok, false);
  assert.match(broken.message, /не ответил/);
  const bad = await service.act('rm -rf' as never);
  assert.equal(bad.ok, false);
  assert.equal(calls.length, 3);
});

test('/api/bridge: статус и действие при включённом моде, 400 на чужое действие, 409 MOD_OFF при выключенном', async (t) => {
  const calls: string[][] = [];
  const service = createBridgeService(async (args) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === 'json' ? QUICK : JSON.stringify({ ok: true, message: 'Готово', status: null }) };
  });
  let modOn = true;
  const app = express();
  app.use(express.json());
  app.use('/api/bridge', createBridgeRouter(service, () => modOn));
  app.use((err: { statusCode?: number; code?: string; message: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bridge`;

  const state = (await (await fetch(`${base}/state`)).json()) as { data: { status: { route: string } } };
  assert.equal(state.data.status.route, 'mitya');

  const post = (action: string) => fetch(`${base}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  assert.equal((await post('auto')).status, 200);
  assert.deepEqual(calls.at(-1), ['auto', '--json']);
  assert.equal((await post('off')).status, 400);

  modOn = false;
  const off = await fetch(`${base}/state`);
  assert.equal(off.status, 409);
  assert.equal(((await off.json()) as { error: { code: string } }).error.code, 'MOD_OFF');
});
