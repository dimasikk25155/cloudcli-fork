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
// Only the mounting is checked here — whatever routes the tasks add, a request
// the router does not handle reaches it at its path and passes on.

const MOUNTS: Array<[name: string, mountPath: string, router: express.Router, probeUrl: string]> = [
  ['master-session', '/api/master-session', masterSessionRoutes, '/api/master-session'],
  ['artifacts', '/api/projects/:projectId/artifacts', artifactsRoutes, '/api/projects/p1/artifacts'],
  ['sidebar-groups', '/api/sidebar-groups', sidebarGroupsRoutes, '/api/sidebar-groups'],
  ['settings-profile', '/api/settings-profile', settingsProfileRoutes, '/api/settings-profile'],
  ['diagnostics', '/api/diagnostics', diagnosticsRoutes, '/api/diagnostics'],
];

// Deep enough not to match any real route of a filled router.
const UNHANDLED = '/__neo3-mount-probe/a/b/c/d/e';

async function listen(app: express.Express, t: { after: (fn: () => void) => void }): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('each workbench router is an express router reached at its mount path', async (t) => {
  const app = express();
  for (const [name, mountPath, router] of MOUNTS) {
    assert.equal(typeof router, 'function', name);
    const mark: express.RequestHandler = (_req, res, next) => {
      res.locals.reached = name;
      next();
    };
    app.use(mountPath, mark, router);
  }
  app.use((_req, res) => res.status(404).json({ reached: res.locals.reached ?? null }));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ reached: res.locals.reached ?? null });
  });
  const base = await listen(app, t);

  for (const [name, , , probeUrl] of MOUNTS) {
    const response = await fetch(`${base}${probeUrl}${UNHANDLED}`);
    assert.equal(response.status, 404, name);
    assert.deepEqual(await response.json(), { reached: name }, name);
  }
});

test('the artifacts router sees :projectId of its mount path (mergeParams)', async (t) => {
  const app = express();
  const probe = express.Router({ mergeParams: true });
  probe.get(UNHANDLED, (req, res) => res.json({ projectId: (req.params as Record<string, string>).projectId ?? null }));
  app.use('/api/projects/:projectId/artifacts', artifactsRoutes);
  artifactsRoutes.use(probe);
  const base = await listen(app, t);

  const response = await fetch(`${base}/api/projects/p42/artifacts${UNHANDLED}`);
  assert.deepEqual(await response.json(), { projectId: 'p42' });
});

test('keep-awake starts with a session-status feed and stop releases every subscription', () => {
  let subscribed = 0;
  let released = 0;
  const handle = startKeepAwake({
    sessionAttention: {
      onChange: () => {
        subscribed += 1;
        return () => { released += 1; };
      },
    },
  });
  assert.equal(typeof handle.stop, 'function');
  handle.stop();
  assert.equal(released, subscribed);
});
