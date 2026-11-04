import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { artifactsRoutes } from '@/modules/artifacts/index.js';
import { diagnosticsRoutes } from '@/modules/diagnostics/index.js';
import { startKeepAwake } from '@/modules/keep-awake/index.js';
import { masterSessionRoutes } from '@/modules/master-session/index.js';
import { settingsProfileRoutes } from '@/modules/settings-profile/index.js';
import { sidebarGroupsRoutes } from '@/modules/sidebar-groups/index.js';

// The workbench build mounts these routers in server/index.js once (same
// paths as below) so the tasks that fill them never edit server/index.js.
// An empty router answers 404 and the server keeps running.

const pass: express.RequestHandler = (_req, _res, next) => next();

test('the stub routers mount at their paths and answer 404 without failing', async (t) => {
  const app = express();
  app.use('/api/master-session', pass, masterSessionRoutes);
  app.use('/api/projects/:projectId/artifacts', pass, artifactsRoutes);
  app.use('/api/sidebar-groups', pass, sidebarGroupsRoutes);
  app.use('/api/settings-profile', pass, settingsProfileRoutes);
  app.use('/api/diagnostics', pass, diagnosticsRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const url of [
    '/api/master-session/questions',
    '/api/projects/p1/artifacts',
    '/api/sidebar-groups',
    '/api/settings-profile/preview',
    '/api/diagnostics/advisor',
  ]) {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 404, url);
    assert.deepEqual(await response.json(), { error: 'not found' }, url);
  }
});

test('the artifacts router sees :projectId of its mount path', async (t) => {
  const app = express();
  const probe = express.Router({ mergeParams: true });
  probe.get('/__probe', (req, res) => res.json({ projectId: (req.params as Record<string, string>).projectId ?? null }));
  app.use('/api/projects/:projectId/artifacts', artifactsRoutes);
  artifactsRoutes.use(probe);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const response = await fetch(`${base}/api/projects/p42/artifacts/__probe`);
  assert.deepEqual(await response.json(), { projectId: 'p42' });
});

test('keep-awake stub subscribes to nothing yet and stops cleanly', () => {
  let subscribed = 0;
  const handle = startKeepAwake({
    sessionAttention: {
      onChange: () => {
        subscribed += 1;
        return () => {};
      },
    },
  });
  assert.equal(typeof handle.stop, 'function');
  handle.stop();
  assert.equal(subscribed, 0);
});
