import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createMemorySuggestionsRouter } from '@/modules/memory-suggestions/memory-suggestions.routes.js';
import type { MemorySuggestionsService } from '@/modules/memory-suggestions/memory-suggestions.service.js';

// Boundary `memory-suggestions`: GET /api/memory-suggestions?sessionId=,
// POST /:id/write (admin) → {path}, POST /:id/dismiss.

function fakeService(calls: string[]): MemorySuggestionsService {
  return {
    runCheck: async () => ({ reviewed: 0 }),
    hasVault: () => true,
    recoverInterruptedWrites: () => 0,
    list: (user, filter) => {
      calls.push(`list:${user.role}:${filter?.sessionId ?? '*'}`);
      return [];
    },
    write: async (user, id) => {
      calls.push(`write:${user.role}:${id}`);
      return { status: 'ok', path: '/vault/wiki/synthesis/x.md', relativePath: 'wiki/synthesis/x.md' };
    },
    dismiss: (user, id) => {
      calls.push(`dismiss:${user.role}:${id}`);
      return { status: 'ok' };
    },
  };
}

async function serve(t: test.TestContext, calls: string[]) {
  const app = express();
  app.use(express.json());
  // authenticateToken stand-in: the role comes from the Authorization header.
  app.use('/api/memory-suggestions', (req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { id: 7, role: req.headers.authorization };
    next();
  }, createMemorySuggestionsRouter(fakeService(calls)));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/memory-suggestions`;
  return (method: string, pathName: string, role: string) =>
    fetch(`${base}${pathName}`, { method, headers: { Authorization: role, 'Content-Type': 'application/json' } });
}

test('POST /:id/write is admin-only and answers with the written path', async (t) => {
  const calls: string[] = [];
  const request = await serve(t, calls);

  const denied = await request('POST', '/5/write', 'user');
  assert.equal(denied.status, 403);
  assert.deepEqual(calls, [], 'a non-admin never reaches the writer');

  const ok = await request('POST', '/5/write', 'admin');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { path: '/vault/wiki/synthesis/x.md', relativePath: 'wiki/synthesis/x.md' });
  assert.deepEqual(calls, ['write:admin:5']);
});

test('POST /:id/dismiss is admin-only too', async (t) => {
  const calls: string[] = [];
  const request = await serve(t, calls);

  assert.equal((await request('POST', '/5/dismiss', 'user')).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await request('POST', '/5/dismiss', 'admin')).status, 200);
  assert.deepEqual(calls, ['dismiss:admin:5']);
});
