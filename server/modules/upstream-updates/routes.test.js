import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import { mountUpstreamRoutes } from './index.js';

test('HTTP report routes require authentication/admin and every legacy install mode refuses application', async (t) => {
  let checks = 0;
  const app = express();
  app.use(express.json());
  mountUpstreamRoutes(app, {
    authenticateToken: (req, res, next) => req.headers.authorization ? next() : res.sendStatus(401),
    requireAdmin: (req, res, next) => req.headers.authorization === 'admin' ? next() : res.sendStatus(403),
    checker: { read: async () => ({ status: 'ok', approvalRequired: true }), check: async () => { checks++; return { status: 'ok', approvalRequired: true }; } },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [endpoint, method] of [['/api/system/upstream', 'GET'], ['/api/system/upstream/check', 'POST'], ['/api/system/update', 'POST']]) {
    assert.equal((await fetch(url + endpoint, { method })).status, 401);
    assert.equal((await fetch(url + endpoint, { method, headers: { Authorization: 'member' } })).status, 403);
  }
  for (const mode of ['git', 'npm', 'platform']) {
    const response = await fetch(`${url}/api/system/update`, { method: 'POST', headers: { Authorization: 'admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ installMode: mode, IS_PLATFORM: mode === 'platform', approved: true }) });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'UPSTREAM_APPROVAL_REQUIRED');
    assert.equal(body.approvalRequired, true);
  }
  assert.equal(checks, 0);
  const cached = await fetch(`${url}/api/system/upstream`, { headers: { Authorization: 'admin' } });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).approvalRequired, true);
  const checked = await fetch(`${url}/api/system/upstream/check`, { method: 'POST', headers: { Authorization: 'admin' } });
  assert.equal(checked.status, 200);
  assert.equal(checks, 1);
});
