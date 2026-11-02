import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { createFilePreviewService } from '../file-preview.service.js';
import { createFilePreviewRoutes } from '../file-preview.routes.js';

test('HTTP preview serves HTML and relative assets without authentication credentials', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'страницы с пробелами'));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'страницы с пробелами', 'страница.html'), '<link rel="stylesheet" href="../assets/style.css"><h1>Страница</h1><script type="module" src="../assets/app.js"></script>');
  await fs.writeFile(path.join(root, 'assets', 'style.css'), 'body{background:url(./pic.svg)}');
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'import "./other.js";');
  await fs.writeFile(path.join(root, 'assets', 'other.js'), 'document.title="works"');
  await fs.writeFile(path.join(root, 'assets', 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.mkdir(path.join(root, '.secrets'));
  await fs.writeFile(path.join(root, '.secrets', 'config.js'), 'private');
  await fs.symlink(path.join(root, '.secrets'), path.join(root, 'assets', 'private'));
  await fs.writeFile(path.join(root, '.env.html'), 'private');
  await fs.writeFile(path.join(root, 'secrets.js'), 'private');
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'html-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'private.js'), 'private');
  await fs.symlink(path.join(outside, 'private.js'), path.join(root, 'assets', 'escape.js'));
  let clock = 10;
  let allowed = true;
  const service = createFilePreviewService({ now: () => clock, ttlMs: 100, canAccess: () => allowed });
  const routes = createFilePreviewRoutes({ service, projectRoot: async () => root, access: () => allowed, admin: () => false, resolve: async ({ filePath }: { filePath: string }) => ({ ok: true, resolved: path.resolve(root, filePath) }) });
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/files/preview', (req, _res, next) => { Object.assign(req, { user: { id: 1 } }); next(); }, routes.create);
  app.use('/api/file-preview', routes.assets);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const create = (file: string) => fetch(`${origin}/api/projects/project/files/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file }) });
  const response = await create('страницы с пробелами/страница.html');
  assert.equal(response.status, 200);
  const grant = await response.json() as { url: string };
  const url = new URL(grant.url, origin);
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type')!, /text\/html/);
  assert.match(await html.text(), /<h1>Страница<\/h1>/);
  assert.match(html.headers.get('content-security-policy')!, /sandbox allow-scripts;/);
  assert.doesNotMatch(html.headers.get('content-security-policy')!, /allow-same-origin/);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  const cssUrl = new URL('../assets/style.css', url);
  const css = await fetch(cssUrl);
  assert.match(css.headers.get('content-type')!, /text\/css/);
  assert.match(await css.text(), /url\(\.\/pic.svg\)/);
  assert.equal((await fetch(new URL('./pic.svg', cssUrl))).status, 200);
  const jsUrl = new URL('../assets/app.js', url);
  assert.match(await (await fetch(jsUrl)).text(), /import "\.\/other.js"/);
  assert.equal((await fetch(new URL('./other.js', jsUrl))).status, 200);
  for (const resource of ['../.env.html', '../secrets.js', '../package.json', '../assets/escape.js', '../assets/private/config.js']) {
    assert.equal((await fetch(new URL(resource, url))).status, 403, resource);
  }
  assert.equal((await create('.env.html')).status, 403);
  assert.equal((await create(path.join(outside, 'private.js'))).status, 403);
  const token = grant.url.split('/')[3];
  await assert.rejects(service.resource(token, '../private.js'), { status: 403 });
  await assert.rejects(service.resource(token, '/etc/passwd'), { status: 403 });
  assert.equal((await fetch(new URL('../missing.css', url))).status, 404);
  allowed = false;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await create('страницы с пробелами/страница.html')).status, 403);
  allowed = true;
  clock = 111;
  assert.equal((await fetch(url)).status, 403);
});

test('admin file outside project scopes only its own directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-admin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'project'));
  await fs.mkdir(path.join(root, 'external'));
  await fs.writeFile(path.join(root, 'external', 'index.htm'), 'hello');
  const service = createFilePreviewService();
  const grant = await service.issue({ file: path.join(root, 'external', 'index.htm'), projectRoot: path.join(root, 'project'), projectId: 'p', userId: 1, admin: true });
  const token = grant.url.split('/')[3];
  assert.equal(await service.resource(token, 'index.htm'), path.join(await fs.realpath(root), 'external', 'index.htm'));
  await assert.rejects(service.resource(token, '../project/file.js'), { status: 403 });
});

for (const directory of ['secrets', 'credentials', '.secrets']) {
  test(`admin cannot publish HTML from external ${directory} directory`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-private-root-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'project'));
    await fs.mkdir(path.join(root, directory, 'nested'), { recursive: true });
    const file = path.join(root, directory, 'nested', 'index.html');
    await fs.writeFile(file, '<h1>Private</h1>');
    const service = createFilePreviewService();
    await assert.rejects(service.issue({ file, projectRoot: path.join(root, 'project'), projectId: 'p', userId: 1, admin: true }), { status: 403 });
  });
}
