import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createWorkspaceStore } from '@/modules/agent-workspace/index.js';
import { createArtifactsService } from '@/modules/artifacts/index.js';
import type { IsModOn } from '@/shared/mods.js';

// Публикация, версии, восстановление, комментарии и правило путей артефактов —
// через публичный сервис, на настоящей файловой системе во временной папке.

async function fixture(options: { limits?: { text: number; binary: number }; modOn?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'artifacts-')));
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  const snapshots = path.join(root, 'snapshots');
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_records(id TEXT PRIMARY KEY,kind TEXT,owner_user_id INTEGER,project_id TEXT,revision INTEGER,payload TEXT,created_at TEXT,updated_at TEXT)');
  let clock = 0;
  const isModOn: IsModOn = () => options.modOn ?? true;
  const service = createArtifactsService({
    store: createWorkspaceStore(db),
    projectPath: (id) => (id === 'p' ? project : id === 'q' ? outside : null),
    canAccessProject: (userId, projectId) => userId === 1 && (projectId === 'p' || projectId === 'q'),
    sessionProjectId: (_userId, sessionId) => (sessionId === 'chat-p' ? 'p' : sessionId === 'chat-q' ? 'q' : null),
    isModOn,
    snapshotRoot: () => snapshots,
    now: () => new Date(Date.UTC(2026, 10, 4, 12, 0, clock++)).toISOString(),
    limits: options.limits,
  });
  const close = async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  return { service, project, outside, snapshots, close };
}

test('publish → list → change → new version → restore creates a «restore» version with the old content', async () => {
  const { service, project, close } = await fixture();
  try {
    await mkdir(path.join(project, 'docs'));
    await writeFile(path.join(project, 'docs', 'infographic.html'), '<h1>v1</h1>');
    const published = await service.publish(1, 'p', { path: 'docs/infographic.html', sessionId: 'chat-p', messageId: 'm-7' });
    assert.equal(published.artifact.kind, 'html');
    assert.equal(published.artifact.path, 'docs/infographic.html');
    assert.equal(published.artifact.title, 'infographic.html');
    assert.equal(published.artifact.sessionId, 'chat-p');
    assert.equal(published.artifact.messageId, 'm-7');
    assert.deepEqual(published.versions.map((v) => [v.n, v.source]), [[1, 'publish']]);
    assert.equal(published.file.exists, true);
    assert.equal(published.file.absPath, path.join(project, 'docs', 'infographic.html'));

    const again = await service.publish(1, 'p', { path: path.join(project, 'docs', 'infographic.html') });
    assert.equal(again.artifact.id, published.artifact.id, 'the same file is one artifact');
    assert.equal(again.versions.length, 1, 'unchanged content adds no version');

    const list = await service.list(1, 'p');
    assert.deepEqual(list.map((item) => item.id), [published.artifact.id]);

    await writeFile(path.join(project, 'docs', 'infographic.html'), '<h1>v2</h1>');
    const refreshed = await service.refresh(1, 'p', published.artifact.id);
    assert.equal(refreshed.changed, true);
    assert.deepEqual(refreshed.versions.map((v) => [v.n, v.source]), [[1, 'publish'], [2, 'change']]);
    assert.equal(refreshed.artifact.latestVersion, 2);
    const noChange = await service.refresh(1, 'p', published.artifact.id);
    assert.equal(noChange.changed, false);
    assert.equal(noChange.versions.length, 2);

    const v1 = await service.versionContent(1, 'p', published.artifact.id, 1);
    assert.equal(v1.data.toString('utf8'), '<h1>v1</h1>');

    const restored = await service.restore(1, 'p', published.artifact.id, 1);
    assert.deepEqual(restored.versions.map((v) => [v.n, v.source]), [[1, 'publish'], [2, 'change'], [3, 'restore']]);
    assert.equal(restored.versions[2].restoredFrom, 1);
    assert.equal(await readFile(path.join(project, 'docs', 'infographic.html'), 'utf8'), '<h1>v1</h1>');
    assert.equal((await service.versionContent(1, 'p', published.artifact.id, 3)).data.toString('utf8'), '<h1>v1</h1>');
  } finally {
    await close();
  }
});

test('size limits: text over 2 MB-limit and binary over 20 MB-limit keep metadata only; restore of such a version is refused', async () => {
  const { service, project, close } = await fixture({ limits: { text: 10, binary: 20 } });
  try {
    await writeFile(path.join(project, 'big.md'), '# '.padEnd(11, 'x'));
    await writeFile(path.join(project, 'small.png'), Buffer.alloc(20, 1));
    await writeFile(path.join(project, 'big.png'), Buffer.alloc(21, 1));
    const big = await service.publish(1, 'p', { path: 'big.md' });
    assert.equal(big.versions[0].snapshotFile, null);
    assert.equal(big.versions[0].size, 11);
    const small = await service.publish(1, 'p', { path: 'small.png' });
    assert.equal(small.artifact.kind, 'image');
    assert.notEqual(small.versions[0].snapshotFile, null, 'binary at the limit is snapshotted');
    const bigImage = await service.publish(1, 'p', { path: 'big.png' });
    assert.equal(bigImage.versions[0].snapshotFile, null);
    await assert.rejects(service.versionContent(1, 'p', big.artifact.id, 1), (error: { statusCode?: number }) => error.statusCode === 409);
    await assert.rejects(service.restore(1, 'p', big.artifact.id, 1), (error: { statusCode?: number }) => error.statusCode === 409);
  } finally {
    await close();
  }
});

test('paths: «..», a symlink pointing outside, an absolute path outside and secrets are refused; a missing file is 404', async () => {
  const { service, project, outside, close } = await fixture();
  try {
    await writeFile(path.join(outside, 'secret.html'), '<p>outside</p>');
    await symlink(path.join(outside, 'secret.html'), path.join(project, 'link.html'));
    await writeFile(path.join(project, '.env'), 'KEY=1');
    const status = (code: number) => (error: { statusCode?: number }) => error.statusCode === code;
    await assert.rejects(service.publish(1, 'p', { path: '../outside/secret.html' }), status(400));
    await assert.rejects(service.publish(1, 'p', { path: 'docs/../../outside/secret.html' }), status(400));
    await assert.rejects(service.publish(1, 'p', { path: 'link.html' }), status(400));
    await assert.rejects(service.publish(1, 'p', { path: path.join(outside, 'secret.html') }), status(400));
    await assert.rejects(service.publish(1, 'p', { path: '.env' }), status(400));
    await assert.rejects(service.publish(1, 'p', { path: 'nope.html' }), status(404));
    await assert.rejects(service.publish(1, 'p', { path: '' }), status(400));
    assert.deepEqual(await service.list(1, 'p'), []);
  } finally {
    await close();
  }
});

test('a deleted file: the artifact says so and its last version stays readable', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'notes.md'), '# Итог');
    const published = await service.publish(1, 'p', { path: 'notes.md' });
    await unlink(path.join(project, 'notes.md'));
    const refreshed = await service.refresh(1, 'p', published.artifact.id);
    assert.equal(refreshed.file.exists, false);
    assert.equal(refreshed.changed, false);
    assert.equal((await service.versionContent(1, 'p', published.artifact.id, 1)).data.toString('utf8'), '# Итог');
    const [item] = await service.list(1, 'p');
    assert.equal(item.file.exists, false);
  } finally {
    await close();
  }
});

test('rect and quote comments are saved; «Отправить агенту» makes one message for the source chat with the path and the list', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'dashboard.html'), '<main>Обзор</main>');
    const { artifact } = await service.publish(1, 'p', { path: 'dashboard.html', title: 'Дашборд', sessionId: 'chat-p' });
    const rect = service.addComment(1, 'p', artifact.id, { anchor: { type: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.15 }, text: 'Сделай заголовок крупнее' });
    const quote = service.addComment(1, 'p', artifact.id, { anchor: { type: 'quote', text: 'Обзор' }, text: 'Переименуй в «Сводка»' });
    assert.equal(rect.status, 'open');
    assert.equal(rect.versionN, 1);
    assert.deepEqual(quote.anchor, { type: 'quote', text: 'Обзор' });
    assert.throws(() => service.addComment(1, 'p', artifact.id, { anchor: { type: 'rect', x: 0.9, y: 0, w: 0.5, h: 0.1 }, text: 'x' }), (error: { statusCode?: number }) => error.statusCode === 400);
    assert.throws(() => service.addComment(1, 'p', artifact.id, { anchor: { type: 'quote', text: 'a' }, text: '   ' }), (error: { statusCode?: number }) => error.statusCode === 400);

    const sent = service.sendComments(1, 'p', artifact.id, {});
    assert.equal(sent.sessionId, 'chat-p', 'goes to the chat the artifact came from');
    assert.deepEqual(sent.commentIds.sort(), [rect.id, quote.id].sort());
    assert.ok(sent.text.includes(path.join(project, 'dashboard.html')), 'message names the file');
    assert.match(sent.text, /1\. \[область: слева 10%, сверху 20%, ширина 30%, высота 15%; версия 1\] Сделай заголовок крупнее/);
    assert.match(sent.text, /2\. \[цитата: «Обзор»; версия 1\] Переименуй в «Сводка»/);

    const detail = await service.detail(1, 'p', artifact.id);
    assert.deepEqual(detail.comments.map((c) => c.status), ['sent', 'sent']);
    assert.throws(() => service.sendComments(1, 'p', artifact.id, {}), (error: { statusCode?: number }) => error.statusCode === 400, 'nothing open → refused');

    const resolved = service.updateComment(1, 'p', artifact.id, rect.id, { status: 'resolved' });
    assert.equal(resolved.status, 'resolved');
    assert.throws(() => service.sendComments(1, 'p', artifact.id, { sessionId: 'chat-q' }), (error: { statusCode?: number }) => error.statusCode === 403, 'a chat of another project is refused');
  } finally {
    await close();
  }
});

test('access and mod: another project\'s chat, a project without access and the switched-off mod are refused', async () => {
  const { service, project, close } = await fixture();
  try {
    await writeFile(path.join(project, 'a.md'), '# A');
    await assert.rejects(service.publish(1, 'p', { path: 'a.md', sessionId: 'chat-q' }), (error: { statusCode?: number }) => error.statusCode === 403);
    await assert.rejects(service.list(2, 'p'), (error: { statusCode?: number }) => error.statusCode === 403);
    const { artifact } = await service.publish(1, 'p', { path: 'a.md' });
    await assert.rejects(service.detail(1, 'q', artifact.id), (error: { statusCode?: number }) => error.statusCode === 404, 'an id from another project is not found there');
  } finally {
    await close();
  }
  const off = await fixture({ modOn: false });
  try {
    await assert.rejects(off.service.list(1, 'p'), (error: { statusCode?: number; code?: string }) => error.statusCode === 409 && error.code === 'MOD_OFF');
  } finally {
    await off.close();
  }
});
