import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { noStoreApi } from '@/middleware/no-store.js';

async function withApp(fn: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api', noStoreApi);
  app.get('/api/user', (_req, res) => {
    res.setHeader('X-Refreshed-Token', 'a.b.c');
    res.json({ user: { id: 1 } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('API responses are marked no-store', async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/user`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('pragma'), 'no-cache');
  });
});

test('a matching If-None-Match still gets a full 200, never a 304 replay', async () => {
  await withApp(async (base) => {
    const first = await fetch(`${base}/api/user`);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await fetch(`${base}/api/user`, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-refreshed-token'), 'a.b.c');
  });
});
