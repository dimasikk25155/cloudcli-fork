import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactsRouter, createArtifactsService } from '@/modules/artifacts/index.js';
import { createFilePreviewRoutes, createFilePreviewService } from '@/modules/file-preview/index.js';
import { AppError } from '@/shared/utils.js';

// HTTP of «Правка артефактов»: PUT /:id/edit and POST /:id/editor-preview, the
// copy served by the real file preview route; the same AppError → JSON shape
// as the global middleware of server/index.js.

type Options = { off?: string[]; access?: boolean; textLimit?: number };

async function withServer(options: Options, runTest: (urls: { api: string; origin: string }, project: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'artifacts-edit-routes-')));
  const project = path.join(root, 'project');
  await mkdir(project);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  const preview = createFilePreviewService({ canAccess: () => options.access ?? true });
  const service = createArtifactsService({
    store: createWorkspaceStore(db),
    projectPath: (id) => (id === 'p' ? project : null),
    canAccessProject: () => options.access ?? true,
    isModOn: (_userId, key) => !(options.off ?? []).includes(key),
    snapshotRoot: () => path.join(root, 'snapshots'),
    limits: options.textLimit ? { text: options.textLimit, binary: 1000 } : undefined,
    documentGrant: (input) => preview.createDocumentGrant(input),
  });
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/file-preview', createFilePreviewRoutes({ service: preview, resolve: async () => ({ ok: false, status: 400, error: 'unused' }) }).assets);
  app.use((req, _res, next) => { (req as express.Request & { user: { id: number } }).user = { id: 1 }; next(); });
  app.use('/api/projects/:projectId/artifacts', createArtifactsRouter(() => service));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message }, details: error.details });
      return;
    }
    res.status(500).json({ success: false });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await runTest({ api: `${origin}/api/projects/p/artifacts`, origin }, project);
  } finally {
    server.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

async function publish(api: string, file: string): Promise<string> {
  const response = await fetch(api, json('POST', { path: file }));
  assert.equal(response.status, 200, file);
  return ((await response.json()) as { data: { artifact: { id: string } } }).data.artifact.id;
}

test('PUT /:id/edit saves a version «edit»; a file changed on disk → 409 ARTIFACT_EDIT_CONFLICT with the latest version', async () => {
  await withServer({}, async ({ api }, project) => {
    await writeFile(path.join(project, 'page.html'), '<h1>v1</h1>');
    const id = await publish(api, 'page.html');
    const saved = await fetch(`${api}/${id}/edit`, json('PUT', { content: '<h1>правка</h1>', baseVersionN: 1 }));
    assert.equal(saved.status, 200);
    const body = await saved.json() as { success: boolean; data: { versions: Array<{ n: number; source: string }> } };
    assert.equal(body.success, true);
    assert.deepEqual(body.data.versions.map((v) => [v.n, v.source]), [[1, 'publish'], [2, 'edit']]);
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<h1>правка</h1>');

    await writeFile(path.join(project, 'page.html'), '<h1>агент</h1>');
    const conflict = await fetch(`${api}/${id}/edit`, json('PUT', { content: '<h1>моя</h1>', baseVersionN: 2 }));
    assert.equal(conflict.status, 409);
    const error = await conflict.json() as { error: { code: string }; details: { latestVersion: number } };
    assert.equal(error.error.code, 'ARTIFACT_EDIT_CONFLICT');
    assert.equal(error.details.latestVersion, 3);
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<h1>агент</h1>');
  });
});

test('POST /:id/editor-preview → a file preview url serving the sent HTML under the preview CSP, other files from disk', async () => {
  await withServer({}, async ({ api, origin }, project) => {
    await mkdir(path.join(project, 'site'));
    await writeFile(path.join(project, 'site', 'page.html'), '<link rel="stylesheet" href="style.css"><h1>диск</h1>');
    await writeFile(path.join(project, 'site', 'style.css'), 'h1{color:red}');
    const id = await publish(api, 'site/page.html');
    const copy = '<!DOCTYPE html><html><head><script data-neo3-bridge>1</script></head><body><h1 data-neo3-id="1">диск</h1></body></html>';
    const response = await fetch(`${api}/${id}/editor-preview`, json('POST', { html: copy }));
    assert.equal(response.status, 200);
    const { data } = await response.json() as { data: { url: string } };
    assert.match(data.url, /^\/api\/file-preview\/[0-9a-f]{48}\/site\/page\.html$/);
    const page = await fetch(new URL(data.url, origin));
    assert.equal(page.status, 200);
    assert.equal(await page.text(), copy);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    const csp = page.headers.get('content-security-policy') ?? '';
    assert.match(csp, /sandbox allow-scripts;/);
    assert.match(csp, /connect-src 'none'/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    const css = await fetch(new URL('style.css', new URL(data.url, origin)));
    assert.equal(await css.text(), 'h1{color:red}');
  });
});

test('refusals of both routes: unsupported kind 400, over the text limit 413, a link into a private file 400', async () => {
  await withServer({ textLimit: 64 }, async ({ api }, project) => {
    await writeFile(path.join(project, 'notes.md'), '# a');
    await writeFile(path.join(project, 'page.html'), '<p>a</p>');
    await mkdir(path.join(project, '.git'));
    await writeFile(path.join(project, '.git', 'x.html'), '<p>git</p>');
    const md = await publish(api, 'notes.md');
    const page = await publish(api, 'page.html');
    const status = async (url: string, init: RequestInit) => (await fetch(url, init)).status;
    assert.equal(await status(`${api}/${md}/edit`, json('PUT', { content: '# b', baseVersionN: 1 })), 400);
    assert.equal(await status(`${api}/${md}/editor-preview`, json('POST', { html: '<p>' })), 400);
    assert.equal(await status(`${api}/${page}/edit`, json('PUT', { content: 'x'.repeat(65), baseVersionN: 1 })), 413);
    assert.equal(await status(`${api}/${page}/editor-preview`, json('POST', { html: 'x'.repeat(65) })), 413);
    await rm(path.join(project, 'page.html'));
    await symlink('.git/x.html', path.join(project, 'page.html'));
    assert.equal(await status(`${api}/${page}/edit`, json('PUT', { content: '<p>b</p>', baseVersionN: 1 })), 400);
    assert.equal(await status(`${api}/${page}/editor-preview`, json('POST', { html: '<p>b</p>' })), 400);
    assert.equal(await readFile(path.join(project, '.git', 'x.html'), 'utf8'), '<p>git</p>');
  });
});

test('mod «Правка артефактов» off → 409 MOD_OFF; no access to the project → 403', async () => {
  await withServer({ off: ['modArtifactEditor'] }, async ({ api }, project) => {
    await writeFile(path.join(project, 'page.html'), '<p>a</p>');
    const id = await publish(api, 'page.html');
    for (const [url, init] of [
      [`${api}/${id}/edit`, json('PUT', { content: '<p>b</p>', baseVersionN: 1 })],
      [`${api}/${id}/editor-preview`, json('POST', { html: '<p>b</p>' })],
    ] as Array<[string, RequestInit]>) {
      const response = await fetch(url, init);
      assert.equal(response.status, 409, url);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'MOD_OFF');
    }
    assert.equal(await readFile(path.join(project, 'page.html'), 'utf8'), '<p>a</p>');
  });
  await withServer({ access: false }, async ({ api }) => {
    assert.equal((await fetch(`${api}/x/edit`, json('PUT', { content: '<p>b</p>', baseVersionN: 1 }))).status, 403);
    assert.equal((await fetch(`${api}/x/editor-preview`, json('POST', { html: '<p>b</p>' }))).status, 403);
  });
});
