import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { createKrabikRouter } from '@/modules/krabik/krabik.routes.js';
import type { KrabikService } from '@/modules/krabik/krabik.service.js';

function fakeService(calls: string[]): KrabikService {
  return {
    getState: async () => ({ reachable: true, status: 'idle', title: 'Готов', completionSeq: 3 }),
    getMessages: async () => [{ id: '1', role: 'assistant', text: 'Привет', at: null }],
    sendPrompt: async (text) => {
      calls.push(`prompt:${String(text)}`);
    },
    stop: async () => {
      calls.push('stop');
    },
    wake: async () => 'ok',
    listReports: async () => [],
    readReport: async () => '',
  };
}

test('/api/krabik: работает при включённом моде и отвечает 409 MOD_OFF при выключенном', async (t) => {
  const calls: string[] = [];
  let modOn = true;
  const app = express();
  app.use(express.json());
  app.use('/api/krabik', createKrabikRouter(fakeService(calls), () => modOn));
  app.use((err: { statusCode?: number; code?: string; message: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/krabik`;

  const state = (await (await fetch(`${base}/state`)).json()) as { data: { status: string; messages: Array<{ text: string }> } };
  assert.equal(state.data.status, 'idle');
  assert.equal(state.data.messages[0].text, 'Привет');

  const sent = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Проверь ботов' }),
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(calls, ['prompt:Проверь ботов']);

  modOn = false;
  const refused = await fetch(`${base}/stop`, { method: 'POST' });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'MOD_OFF');
  assert.deepEqual(calls, ['prompt:Проверь ботов']);
});
