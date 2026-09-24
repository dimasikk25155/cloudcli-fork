import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import projectRoutes from '@/modules/projects/projects.routes.js';

const CANARY = 'ghp_CANARY0000synthetic0000route';

async function withServer(run: (base: string, asUser: (id: number) => Record<string, string>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  // Stand-in for authenticateToken: the test picks the user via a header.
  app.use((req, _res, next) => {
    const id = Number(req.header('x-test-user'));
    if (id) (req as typeof req & { user?: unknown }).user = { id, role: 'user' };
    next();
  });
  app.use('/api/projects', projectRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  try {
    await run(base, (id) => ({ 'x-test-user': String(id), 'content-type': 'application/json' }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /clone parks the token and returns an opaque id; GET claims it once for the same user only', async () => {
  await withServer(async (base, asUser) => {
    const posted = await fetch(`${base}/clone`, {
      method: 'POST',
      headers: asUser(1),
      // A credential-bearing URL fails validation before git runs, so no clone is spawned.
      body: JSON.stringify({ path: '/tmp', githubUrl: `https://${CANARY}@github.com/a/b.git`, newGithubToken: CANARY }),
    });
    assert.equal(posted.status, 200);
    const { cloneId } = (await posted.json()) as { cloneId: string };
    assert.ok(cloneId && !cloneId.includes(CANARY));

    const foreign = await fetch(`${base}/clone-progress?cloneId=${cloneId}`, { headers: asUser(2) });
    assert.equal(foreign.status, 404, 'another user cannot claim the request');

    const stream = await fetch(`${base}/clone-progress?cloneId=${cloneId}`, { headers: asUser(1) });
    assert.equal(stream.status, 200);
    const body = await stream.text();
    assert.match(body, /"type":"error"/);
    assert.ok(!body.includes(CANARY));

    const replay = await fetch(`${base}/clone-progress?cloneId=${cloneId}`, { headers: asUser(1) });
    assert.equal(replay.status, 404, 'ids are single-use');
  });
});

test('legacy query-string clone requests are refused instead of cloning', async () => {
  await withServer(async (base, asUser) => {
    const legacy = await fetch(
      `${base}/clone-progress?path=/tmp&githubUrl=https://github.com/a/b.git&newGithubToken=${CANARY}`,
      { headers: asUser(1) },
    );
    assert.equal(legacy.status, 404);
    assert.ok(!(await legacy.text()).includes(CANARY));
  });
});

test('clone routes require an authenticated user', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/clone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401);
  });
});
