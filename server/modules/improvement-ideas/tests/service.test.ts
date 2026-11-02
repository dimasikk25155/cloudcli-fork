import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';

import { initializeDatabase, closeConnection, projectsDb, sessionsDb, userDb, improvementIdeasDb  } from '@/modules/database/index.js';

import { createImprovementIdeasService } from '../improvement-ideas.service.js';
import { createImprovementIdeasRouter } from '../improvement-ideas.routes.js';
import { writeIdeasVault } from '../idea-vault.js';

let directory: string;
let admin: number;
let guest: number;
let projectPath: string;
let enabled = true;
let service: ReturnType<typeof createImprovementIdeasService>;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'neo3-ideas-world-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  admin = Number(userDb.createUserWithRole('ideas-admin', 'x', 'admin').id);
  guest = Number(userDb.createUserWithRole('ideas-user', 'x', 'user').id);
  projectPath = path.join(directory, 'project');
  projectsDb.createProjectPath(projectPath);
  sessionsDb.createAppSession('ideas-session', 'codex', projectPath);
  sessionsDb.createAppSession('ideas-second', 'claude', projectPath);
  await mkdir(path.join(directory, 'vault'));
  service = createImprovementIdeasService({ vaultDir: () => path.join(directory, 'vault'), enabled: () => enabled });
});
after(async () => { closeConnection(); await rm(directory, { recursive: true, force: true }); });

test('capture persists once across sessions, reloads, and updates only managed vault section', async () => {
  await service.capture('ideas-session', admin, ['💡 Что можно улучшить дальше: Запоминать выбранный размер.\n🕐 дата']);
  await service.capture('ideas-second', admin, ['💡 Что можно улучшить дальше: Запоминать выбранный размер.\n🕐 дата']);
  const reloaded = createImprovementIdeasService({ vaultDir: () => path.join(directory, 'vault') });
  const rows = reloaded.list(admin, 'ideas-session');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'proposed');
  assert.ok(rows[0].vaultPath);
  const filename = path.join(directory, 'vault', rows[0].vaultPath!);
  const original = await readFile(filename, 'utf8');
  assert.match(original, /Запоминать выбранный размер/);
  assert.match(original, /ideas-session/);
  await writeFile(filename, original + '\nМоя ручная заметка.\n');
  await service.decide(admin, rows[0].id, 'later');
  const updated = await readFile(filename, 'utf8');
  assert.match(updated, /Моя ручная заметка/);
  assert.match(updated, /Статус: Позже/);
  assert.equal(updated.split('## Идея').length, 2);
});

test('mod disabled and non-admin cannot capture, list or approve', async () => {
  const count = service.list(admin, 'ideas-session').length;
  await service.capture('ideas-session', guest, ['💡 Что можно улучшить дальше: Never save this.']);
  assert.throws(() => service.list(guest, 'ideas-session'), /Нет доступа/);
  enabled = false;
  await service.capture('ideas-session', admin, ['💡 Что можно улучшить дальше: Disabled.']);
  await assert.rejects(service.decide(admin, 1, 'implement'), /выключен/);
  enabled = true;
  assert.equal(service.list(admin, 'ideas-session').length, count);
});

test('busy releases claim; concurrent duplicate approval starts exactly once', async () => {
  const idea = service.list(admin, 'ideas-session')[0];
  service.setRunControl({ start: () => false });
  await assert.rejects(service.decide(admin, idea.id, 'implement'), /занят/);
  assert.equal(service.list(admin, 'ideas-session')[0].status, 'later');
  let starts = 0;
  service.setRunControl({ start: ({ content, sessionId }) => {
    starts++; assert.equal(sessionId, 'ideas-session'); assert.match(content, /Запоминать выбранный размер/); return true;
  } });
  await Promise.all([service.decide(admin, idea.id, 'implement'), service.decide(admin, idea.id, 'implement')]);
  assert.equal(starts, 1);
  assert.equal(service.list(admin, 'ideas-session')[0].status, 'started');
});

test('different project has independent dedup and secret-like proposals never persist', async () => {
  const another = path.join(directory, 'another-project');
  projectsDb.createProjectPath(another);
  sessionsDb.createAppSession('ideas-another-project', 'grok', another);
  await service.capture('ideas-another-project', admin, ['💡 Что можно улучшить дальше: Запоминать выбранный размер.']);
  assert.equal(service.list(admin, 'ideas-another-project').length, 1);
  const count = service.list(admin, 'ideas-session').length;
  const syntheticCredential = ['https://', 'sample', ':', 'sample', '@example.invalid'].join('');
  await service.capture('ideas-session', admin, [`💡 Что можно улучшить дальше: Использовать ${syntheticCredential}`]);
  assert.equal(service.list(admin, 'ideas-session').length, count);
});

test('vault unavailable retains database idea and explicit retry succeeds', async () => {
  let root = path.join(directory, 'missing');
  const local = createImprovementIdeasService({ vaultDir: () => root });
  await local.capture('ideas-session', admin, ['💡 Что можно улучшить дальше: Добавить быстрый поиск.']);
  const idea = local.list(admin, 'ideas-session')[0];
  assert.ok(idea.vaultError);
  root = path.join(directory, 'vault');
  const updated = await local.sync(admin, idea.id);
  assert.equal(updated.vaultError, null);
  assert.ok(updated.vaultPath);
});

test('vault refuses symlink directory and pre-existing unowned file', async () => {
  const root = path.join(directory, 'unsafe-vault');
  await mkdir(root);
  await symlink(path.join(directory, 'vault/wiki'), path.join(root, 'wiki'));
  await assert.rejects(writeIdeasVault(root, projectPath, admin, improvementIdeasDb.list(admin, projectPath)), /Unsafe/);
  const rows = service.list(admin, 'ideas-session');
  const file = path.join(directory, 'vault', rows[0].vaultPath!);
  await writeFile(file, 'Чужой файл');
  await service.sync(admin, rows[0].id);
  assert.equal(await readFile(file, 'utf8'), 'Чужой файл');
  assert.ok(service.list(admin, 'ideas-session')[0].vaultError);
});

test('REST exposes cards and decisions with admin and validation boundary', async () => {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: unknown }).user = { id: req.headers['x-guest'] ? guest : admin, role: req.headers['x-guest'] ? 'user' : 'admin' }; next(); });
  app.use('/ideas', createImprovementIdeasRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/ideas?sessionId=ideas-session`);
    assert.equal(response.status, 200); assert.ok(((await response.json()) as { ideas: unknown[] }).ideas.length);
    assert.equal((await fetch(`${origin}/ideas?sessionId=ideas-session`, { headers: { 'x-guest': 'yes' } })).status, 403);
    assert.equal((await fetch(`${origin}/ideas/1/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bad' }) })).status, 400);
    assert.equal((await fetch(`${origin}/ideas/999/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'implement' }) })).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
