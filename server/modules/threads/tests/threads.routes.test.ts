import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createThreadsRoutes, isLocalThreadsRequest, ThreadsError } from '@/modules/threads/index.js';

// HTTP /api/threads/* — authorised by the thread token alone (no JWT): the
// MCP server sends it as a Bearer header; refusals keep their status and text.

async function withServer(
  callTool: (token: unknown, name: string, input: Record<string, unknown>) => Promise<unknown>,
  runTest: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/threads', createThreadsRoutes({ callTool }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await runTest(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/threads`);
  } finally {
    server.close();
  }
}

test('a tool call carries the bearer token, the tool name and the JSON input to the service', async () => {
  const calls: Array<[unknown, string, Record<string, unknown>]> = [];
  await withServer(async (token, name, input) => {
    calls.push([token, name, input]);
    return { threadId: 't-1' };
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/tools/spawn_thread`, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'задача' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { threadId: 't-1' } });
    assert.deepEqual(calls, [['abc123', 'spawn_thread', { prompt: 'задача' }]]);
  });
});

test('no token → 401 without asking the service', async () => {
  let called = false;
  await withServer(async () => { called = true; return {}; }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/tools/thread_status`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
    const body = await response.json() as { success: boolean; error: string };
    assert.equal(body.success, false);
    assert.ok(body.error.length > 0);
    assert.equal(called, false);
  });
});

test('a refusal keeps its status, code and human text', async () => {
  await withServer(async () => {
    throw new ThreadsError('THREAD_LIMIT', 'Уже работают 3 треда из 3', 429);
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/tools/spawn_thread`, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { success: false, code: 'THREAD_LIMIT', error: 'Уже работают 3 треда из 3' });
  });
});

test('an unexpected failure is a 500 without internals', async () => {
  await withServer(async () => {
    throw new Error('SQLITE_BUSY at /Users/secret/path');
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/tools/thread_status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc123' },
    });
    assert.equal(response.status, 500);
    const body = await response.json() as { error: string };
    assert.equal(body.error.includes('/Users/secret'), false);
  });
});

test('a call relayed by a proxy (X-Forwarded-For) is refused before the service', async () => {
  let called = false;
  await withServer(async () => { called = true; return {}; }, async (baseUrl) => {
    for (const header of ['X-Forwarded-For', 'Forwarded', 'X-Real-IP']) {
      const response = await fetch(`${baseUrl}/tools/thread_status`, {
        method: 'POST',
        headers: { Authorization: 'Bearer abc123', [header]: header === 'Forwarded' ? 'for=203.0.113.7' : '203.0.113.7' },
      });
      assert.equal(response.status, 403, header);
    }
    assert.equal(called, false);
  });
});

test('only loopback or the server\'s own address counts as local', () => {
  const local = (remoteAddress: string, localAddress: string, headers: Record<string, string> = {}) =>
    isLocalThreadsRequest({ remoteAddress, localAddress, headers });
  assert.equal(local('127.0.0.1', '127.0.0.1'), true);
  assert.equal(local('::1', '::1'), true);
  assert.equal(local('::ffff:127.0.0.1', '::ffff:127.0.0.1'), true);
  assert.equal(local('100.96.100.39', '100.96.100.39'), true, 'the Mac calling its own Tailscale address');
  assert.equal(local('::ffff:100.96.100.39', '100.96.100.39'), true);
  assert.equal(local('100.64.0.5', '100.96.100.39'), false, 'another tailnet machine');
  assert.equal(local('203.0.113.7', '0.0.0.0'), false);
  assert.equal(local('127.0.0.1', '127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), false);
  assert.equal(local('', ''), false);
});
