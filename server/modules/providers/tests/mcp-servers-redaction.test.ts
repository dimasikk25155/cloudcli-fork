import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, userDb } from '@/modules/database/index.js';
import { providerMcpService, redactMcpServerSecrets } from '@/modules/providers/services/mcp.service.js';

// R08: a teammate (not admin) never gets env/header values of MCP servers from
// GET /api/providers/:provider/mcp/servers — with `?scope=` or without. Keys
// and the shape stay, so the settings screen still renders; the admin sees all.

const VALUE = 'value-must-not-leak';

test('redactMcpServerSecrets empties env and header values, keeps keys and the rest', () => {
  const server = {
    provider: 'claude', name: 'telegram', scope: 'user', transport: 'stdio', command: 'uv', args: ['run', 'x'],
    env: { API_TOKEN: VALUE, CHAT: VALUE }, headers: { Authorization: VALUE }, envHttpHeaders: { 'X-Key': 'X_KEY_VAR' },
  };
  const original = JSON.parse(JSON.stringify(server));

  const redacted = redactMcpServerSecrets({ user: [server], project: [], local: [] });

  assert.deepEqual(redacted.user[0].env, { API_TOKEN: '', CHAT: '' });
  assert.deepEqual(redacted.user[0].headers, { Authorization: '' });
  assert.deepEqual(redacted.user[0].args, ['run', 'x']);
  assert.deepEqual(redacted.user[0].envHttpHeaders, { 'X-Key': 'X_KEY_VAR' });
  assert.deepEqual(server, original, 'the input is not changed');
  assert.deepEqual(redactMcpServerSecrets([server])[0].env, { API_TOKEN: '', CHAT: '' });
});

test('GET /:provider/mcp/servers: values only for the admin, in both branches', { concurrency: false }, async () => {
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
