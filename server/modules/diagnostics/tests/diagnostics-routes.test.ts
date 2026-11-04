import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createDiagnosticsRouter } from '@/modules/diagnostics/diagnostics.routes.js';
import type { DiagnosticsApi } from '@/modules/diagnostics/diagnostics.routes.js';

async function serve(api: Partial<DiagnosticsApi>, userId: number, t: { after: (fn: () => void) => void }) {
  const full: DiagnosticsApi = {
    runDoctor: async () => ({ checks: [], generatedAt: 'x' }),
    runSkillDoctor: async () => ({ skills: [], issues: [], generatedAt: 'x' }),
    advisor: { ask: async () => ({ answer: 'совет' }) },
    isAdmin: () => false,
    isModOn: () => true,
    ...api,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: { id: number } }).user = { id: userId }; next(); });
  app.use('/api/diagnostics', createDiagnosticsRouter(() => full));
  app.use((error: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ code: error.code });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/diagnostics`;
}

test('reports are admin-only, /advisor is open to any signed-in user', async (t) => {
  const member = await serve({ isAdmin: () => false }, 2, t);
  assert.equal((await fetch(`${member}/doctor`)).status, 403);
  assert.equal((await fetch(`${member}/skill-doctor`)).status, 403);
  const answer = await fetch(`${member}/advisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sessionId":"s","question":"q"}' });
  assert.equal(answer.status, 200);
  assert.deepEqual(((await answer.json()) as { data: unknown }).data, { answer: 'совет' });

  const admin = await serve({ isAdmin: () => true }, 1, t);
  assert.equal((await fetch(`${admin}/doctor`)).status, 200);
  assert.equal((await fetch(`${admin}/skill-doctor`)).status, 200);
});

test('modDiagnostics off: every route answers 409 MOD_OFF', async (t) => {
  const base = await serve({ isAdmin: () => true, isModOn: () => false }, 1, t);
  const response = await fetch(`${base}/doctor`);
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { code: string }).code, 'MOD_OFF');
});
