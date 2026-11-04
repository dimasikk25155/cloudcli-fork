import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactsRouter, createArtifactsService } from '@/modules/artifacts/index.js';
import { AppError } from '@/shared/utils.js';

// HTTP /api/projects/:projectId/artifacts: the same AppError → JSON shape as
// the global middleware of server/index.js; «Рабочий стол» off → 409 MOD_OFF.

async function withServer(modOn: boolean, runTest: (baseUrl: string, project: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'artifacts-routes-')));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  const service = createArtifactsService({
    store: createWorkspaceStore(db),
    projectPath: (id) => (id === 'p' ? root : null),
    canAccessProject: () => true,
    sessionProjectId: () => 'p',
    isModOn: () => modOn,
    snapshotRoot: () => path.join(root, '.snapshots'),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as express.Request & { user: { id: number } }).user = { id: 1 }; next(); });
  app.use('/api/projects/:projectId/artifacts', createArtifactsRouter(() => service));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ success: false });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await runTest(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/p/artifacts`, root);
  } finally {
    server.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('publish, list and the snapshot of an HTML version, served as text under a sandbox CSP', async () => {
  await withServer(true, async (baseUrl, project) => {
    await writeFile(path.join(project, 'report.html'), '<script>alert(1)</script>');
    const published = await fetch(baseUrl, json('POST', { path: 'report.html', sessionId: 'chat' }));
    assert.equal(published.status, 200);
    const { data } = await published.json() as { data: { artifact: { id: string } } };
    const list = await (await fetch(baseUrl)).json() as { data: Array<{ id: string }> };
    assert.deepEqual(list.data.map((item) => item.id), [data.artifact.id]);
    const content = await fetch(`${baseUrl}/${data.artifact.id}/versions/1/content`);
    assert.equal(content.status, 200);
    assert.match(content.headers.get('content-type') ?? '', /^text\/plain/);
    assert.match(content.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(await content.text(), '<script>alert(1)</script>');
    const outside = await fetch(baseUrl, json('POST', { path: '../x.html' }));
    assert.equal(outside.status, 400);
  });
});

test('mod «Рабочий стол» off: every route answers 409 MOD_OFF', async () => {
  await withServer(false, async (baseUrl, project) => {
    await writeFile(path.join(project, 'a.md'), '# A');
    for (const [url, init] of [
      [baseUrl, undefined],
      [baseUrl, json('POST', { path: 'a.md' })],
      [`${baseUrl}/x`, undefined],
      [`${baseUrl}/x/refresh`, json('POST', {})],
      [`${baseUrl}/x/versions/1/content`, undefined],
      [`${baseUrl}/x/versions/1/restore`, json('POST', {})],
      [`${baseUrl}/x/comments`, json('POST', { anchor: { type: 'quote', text: 'a' }, text: 'b' })],
      [`${baseUrl}/x/comments/c`, json('PATCH', { status: 'resolved' })],
      [`${baseUrl}/x/send-comments`, json('POST', {})],
    ] as Array<[string, RequestInit | undefined]>) {
      const response = await fetch(url, init);
      assert.equal(response.status, 409, url);
      const body = await response.json() as { error: { code: string } };
      assert.equal(body.error.code, 'MOD_OFF');
    }
  });
});
