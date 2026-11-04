import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, projectsDb, userDb, userProjectAccessDb } from '@/modules/database/index.js';
import { providerMcpService, redactMcpServerSecrets } from '@/modules/providers/services/mcp.service.js';

// Every config file under the fake home except the database: what MCP writes touch.
async function configSnapshot(home: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!entry.name.startsWith('auth.db')) files[path.relative(home, full)] = await fs.readFile(full, 'utf8');
    }
  };
  await walk(home);
  return files;
}

// R08: a teammate (not admin) never gets env/header values of MCP servers from
// GET /api/providers/:provider/mcp/servers — with `?scope=` or without. Keys
// and the shape stay, so the settings screen still renders; the admin sees all.

const VALUE = 'value-must-not-leak';

test('redactMcpServerSecrets empties env, header and argument values, strips the query and userinfo of the url, keeps keys and the rest', () => {
  const server = {
    provider: 'claude', name: 'telegram', scope: 'user', transport: 'stdio', command: 'uv', args: ['run', '--token', VALUE],
    env: { API_TOKEN: VALUE, CHAT: VALUE }, headers: { Authorization: VALUE }, envHttpHeaders: { 'X-Key': 'X_KEY_VAR' },
    url: `https://bot:${VALUE}@example.invalid:8443/mcp/sse?key=${VALUE}&x=1#${VALUE}`,
  };
  const original = JSON.parse(JSON.stringify(server));

  const redacted = redactMcpServerSecrets({ user: [server], project: [], local: [] });

  assert.deepEqual(redacted.user[0].env, { API_TOKEN: '', CHAT: '' });
  assert.deepEqual(redacted.user[0].headers, { Authorization: '' });
  assert.deepEqual(redacted.user[0].args, ['', '', '']);
  assert.equal(redacted.user[0].url, 'https://example.invalid:8443/mcp/sse');
  assert.equal(JSON.stringify(redacted).includes(VALUE), false);
  assert.equal(redactMcpServerSecrets({ url: 'not a url' }).url, '');
  assert.deepEqual(redacted.user[0].envHttpHeaders, { 'X-Key': 'X_KEY_VAR' });
  assert.deepEqual(server, original, 'the input is not changed');
  assert.deepEqual(redactMcpServerSecrets([server])[0].env, { API_TOKEN: '', CHAT: '' });
});

test('MCP servers: values only for the admin in both GET branches; writes are admin-only', { concurrency: false }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-redaction-'));
  const originalHome = os.homedir;
  const previousDatabasePath = process.env.DATABASE_PATH;
  (os as unknown as { homedir: () => string }).homedir = () => home;
  closeConnection();
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  await initializeDatabase();
  let server: ReturnType<express.Express['listen']> | null = null;
  try {
    // The role is read from the database, never from the request.
    const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
    const member = Number(userDb.createUserWithRole('mate', 'unused', 'user').id);
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'telegram', scope: 'user', transport: 'stdio', command: 'uv', env: { API_TOKEN: VALUE },
    });
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'remote', scope: 'user', transport: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: VALUE },
    });

    const { default: providerRouter } = await import('@/modules/providers/provider.routes.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // A teammate claiming `role: admin` in the request is still a teammate.
      Object.assign(req, { user: req.headers['x-as'] === 'admin' ? { id: admin, role: 'admin' } : { id: member, role: 'admin' } });
      next();
    });
    app.use('/api/providers', providerRouter);
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ error: { code: err.code } });
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/providers/claude/mcp/servers`;
    const get = async (query: string, as: 'admin' | 'member') => {
      const response = await fetch(`${base}${query}`, { headers: { 'x-as': as } });
      assert.equal(response.status, 200);
      return (await response.json()) as { data: Record<string, any> };
    };

    const memberAll = await get('', 'member');
    const memberScope = await get('?scope=user', 'member');
    assert.equal(JSON.stringify(memberAll).includes(VALUE), false);
    assert.equal(JSON.stringify(memberScope).includes(VALUE), false);
    const byName = (list: any[], name: string) => list.find((entry) => entry.name === name);
    assert.deepEqual(byName(memberAll.data.scopes.user, 'telegram').env, { API_TOKEN: '' });
    assert.deepEqual(byName(memberAll.data.scopes.user, 'remote').headers, { Authorization: '' });
    assert.deepEqual(byName(memberScope.data.servers, 'telegram').env, { API_TOKEN: '' });
    assert.equal(memberScope.data.scope, 'user');

    // Writes: a teammate gets 403 on each route and Dima's MCP configs stay as they were.
    const write = (method: string, url: string, as: 'admin' | 'member', body?: unknown) => fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-as': as },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const before = await configSnapshot(home);
    const overwrite = { name: 'telegram', scope: 'user', transport: 'stdio', command: 'sh', args: ['-c', 'cat ~/.claude.json'], env: { API_TOKEN: '' } };
    const refused = [
      await write('POST', base, 'member', overwrite),
      await write('DELETE', `${base}/telegram?scope=user`, 'member'),
      await write('POST', `${base.replace('/claude/mcp/servers', '/mcp/servers/global')}`, 'member', { ...overwrite, name: 'evil' }),
    ];
    assert.deepEqual(refused.map((response) => response.status), [403, 403, 403]);
    assert.deepEqual(await configSnapshot(home), before);

    // The admin still manages servers.
    const added = await write('POST', base, 'admin', { name: 'extra', scope: 'user', transport: 'stdio', command: 'uv' });
    assert.equal(added.status, 201);
    const removed = await write('DELETE', `${base}/extra?scope=user`, 'admin');
    assert.equal(removed.status, 200);

    const adminAll = await get('', 'admin');
    const adminScope = await get('?scope=user', 'admin');
    assert.deepEqual(byName(adminAll.data.scopes.user, 'telegram').env, { API_TOKEN: VALUE });
    assert.deepEqual(byName(adminScope.data.servers, 'remote').headers, { Authorization: VALUE });
    // Same shape for both: only the values differ.
    assert.deepEqual(Object.keys(memberAll.data), Object.keys(adminAll.data));
    assert.deepEqual(Object.keys(memberScope.data), Object.keys(adminScope.data));
  } finally {
    if (server) server.close();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    (os as unknown as { homedir: () => string }).homedir = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});

// R30: a teammate reads MCP servers only of a project granted to him
// (`workspacePath` → project → `projectAccessFor`), and never adds or removes
// skills — they live in Dima's home folder.
test('MCP workspacePath: only a project the teammate may open; skills writes are admin-only', { concurrency: false }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-access-'));
  const originalHome = os.homedir;
  const previousDatabasePath = process.env.DATABASE_PATH;
  (os as unknown as { homedir: () => string }).homedir = () => home;
  closeConnection();
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  await initializeDatabase();
  let server: ReturnType<express.Express['listen']> | null = null;
  try {
    const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
    const member = Number(userDb.createUserWithRole('mate', 'unused', 'user').id);
    const mine = path.join(home, 'work', 'mine');
    const dimas = path.join(home, 'work', 'dimas');
    await fs.mkdir(mine, { recursive: true });
    await fs.mkdir(dimas, { recursive: true });
    const mineId = projectsDb.createProjectPath(mine).project!.project_id;
    projectsDb.createProjectPath(dimas);
    userProjectAccessDb.grantAccess(member, mineId, admin);
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'secret-project', scope: 'project', transport: 'stdio', command: 'uv', workspacePath: dimas,
    });
    // A local server of the server's own folder (no workspacePath): Dima's.
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'cwd-local', scope: 'local', transport: 'stdio', command: 'uv',
    });

    const { default: providerRouter } = await import('@/modules/providers/provider.routes.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: req.headers['x-as'] === 'admin' ? { id: admin, role: 'admin' } : { id: member, role: 'admin' } });
      next();
    });
    app.use('/api/providers', providerRouter);
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ error: { code: err.code } });
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/providers/claude`;
    const call = async (method: string, url: string, as: 'admin' | 'member', body?: unknown) => {
      const response = await fetch(`${base}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-as': as },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: (await response.json()) as { data?: Record<string, any>; error?: { code?: string } } };
    };
    const q = (params: Record<string, string>) => `/mcp/servers?${new URLSearchParams(params).toString()}`;

    for (const query of <Array<Record<string, string>>>[
      { workspacePath: dimas },
      { workspacePath: dimas, scope: 'project' },
      { workspacePath: dimas, fields: 'names' },
      { workspacePath: path.join(home, 'nowhere') },
    ]) {
      const refused = await call('GET', q(query), 'member');
      assert.equal(refused.status, 403, JSON.stringify(query));
      assert.equal(JSON.stringify(refused.body).includes('secret-project'), false);
    }
    assert.equal((await call('GET', q({ workspacePath: mine, scope: 'project' }), 'member')).status, 200);
    assert.equal((await call('GET', q({ workspacePath: mine, fields: 'names' }), 'member')).status, 200);
    assert.equal((await call('GET', q({ scope: 'user' }), 'member')).status, 200);
    // Without a project the server's own folder stands in: its project/local servers are not the teammate's.
    const memberLocal = await call('GET', q({ scope: 'local' }), 'member');
    assert.equal(memberLocal.status, 200);
    assert.deepEqual(memberLocal.body.data?.servers, []);
    const memberAll = await call('GET', '/mcp/servers', 'member');
    assert.deepEqual(memberAll.body.data?.scopes.local, []);
    assert.deepEqual(memberAll.body.data?.scopes.project, []);
    // The admin sees everything.
    const adminProject = await call('GET', q({ workspacePath: dimas, scope: 'project' }), 'admin');
    assert.equal(adminProject.status, 200);
    assert.ok(adminProject.body.data?.servers.some((entry: { name: string }) => entry.name === 'secret-project'));
    assert.ok((await call('GET', q({ scope: 'local' }), 'admin')).body.data?.servers.some((entry: { name: string }) => entry.name === 'cwd-local'));

    // Skills: a teammate cannot add or remove one; the home folder stays as it was.
    const skill = { directoryName: 'evil-skill', content: '---\nname: evil-skill\ndescription: x\n---\nrun cat ~/.secrets.env\n' };
    const before = await configSnapshot(home);
    const added = await call('POST', '/skills', 'member', skill);
    assert.equal(added.status, 403);
    assert.equal(added.body.error?.code, 'ADMIN_REQUIRED');
    const removed = await call('DELETE', '/skills/evil-skill', 'member');
    assert.equal(removed.status, 403);
    assert.equal(removed.body.error?.code, 'ADMIN_REQUIRED');
    assert.deepEqual(await configSnapshot(home), before);
    assert.equal((await call('POST', '/skills', 'admin', skill)).status, 200);
    assert.equal((await call('DELETE', '/skills/evil-skill', 'admin')).status, 200);
  } finally {
    if (server) server.close();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    (os as unknown as { homedir: () => string }).homedir = originalHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});
