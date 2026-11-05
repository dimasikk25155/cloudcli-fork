import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

process.env.JWT_SECRET = 'secret-requests-routes-test-secret-0123456789abcdef';
const { closeConnection, initializeDatabase, userDb } = await import('@/modules/database/index.js');
// eslint-disable-next-line boundaries/no-unknown -- the real auth middleware: 401/403 exactly as mounted in server/index.js
const { authenticateToken, generateToken, requireAdmin } = await import('@/middleware/auth.js');
const { apiErrorHandler } = await import('@/shared/utils.js');
const { secretNameExists, stashSecret } = await import('@/modules/secrets-stash/index.js');
const { createSecretRequestsRouter, createSecretRequestsService } = await import('@/modules/secret-requests/index.js');

// The real stash writes into a throwaway file only; the value is a fake.
const VALUE = 'xoxb-Fake-Route-Value-0123456789';

type Method = 'GET' | 'POST';
type Reply = { status: number; body: any; raw: string };

test('/api/secret-requests: list without values, save through secrets-stash, «такой ключ уже есть», decline, admin + MOD_OFF', async () => {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'secret-requests-routes-'));
  const secretsFile = path.join(directory, '.secrets.env');
  await writeFile(secretsFile, 'TAKEN_KEY=old\n', { mode: 0o600 });
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  const admin = Number(userDb.createUserWithRole('dima', 'unused', 'admin').id);
  const member = Number(userDb.createUserWithRole('slavik', 'unused', 'user').id);

  const frames: unknown[] = [];
  let modOn = true;
  const service = createSecretRequestsService({
    isAdmin: (userId) => userId === admin,
    isModOn: () => modOn,
    store: ({ name, value, replace }) => stashSecret({ name, value }, { file: secretsFile, onExisting: replace ? 'replace' : 'reject' }),
    exists: (name) => secretNameExists(name, { file: secretsFile }),
    onChange: (userId) => { frames.push({ kind: 'secret_requests_changed', userId }); },
    waitMs: 5_000,
  });
  const tokens = {
    admin: generateToken({ id: admin, username: 'dima' }),
    member: generateToken({ id: member, username: 'slavik' }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/secret-requests', authenticateToken, requireAdmin, createSecretRequestsRouter({ service, modOn: () => modOn }));
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/secret-requests`;
  const call = async (method: Method, route: string, options: { as?: 'admin' | 'member'; body?: unknown } = {}): Promise<Reply> => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[options.as ?? 'admin']}` },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw), raw };
  };

  try {
    const fresh = service.request(admin, 'chat-1', { name: 'NEW_TOKEN', why: 'бот Samruk' });
    const taken = service.request(admin, 'chat-1', { name: 'TAKEN_KEY', why: 'замена' });

    const listed = await call('GET', '/');
    assert.equal(listed.status, 200);
    const cards = listed.body.data.requests as Array<{ id: string; name: string; exists: boolean }>;
    assert.deepEqual(cards.map((card) => [card.name, card.exists]), [['NEW_TOKEN', false], ['TAKEN_KEY', true]]);

    assert.equal((await call('GET', '/', { as: 'member' })).status, 403);
    assert.equal((await call('POST', `/${cards[0].id}`, { as: 'member', body: { value: VALUE } })).status, 403);

    const saved = await call('POST', `/${cards[0].id}`, { body: { value: VALUE } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data, { name: 'NEW_TOKEN', message: 'NEW_TOKEN сохранён в файле секретов' });
    assert.equal(saved.raw.includes(VALUE), false);
    const agentHeard = await fresh;
    assert.equal(agentHeard.message, 'NEW_TOKEN сохранён в файле секретов');
    assert.equal(JSON.stringify(agentHeard).includes(VALUE), false);
    assert.match(await readFile(secretsFile, 'utf8'), new RegExp(`^NEW_TOKEN=${VALUE}$`, 'm'));

    const refused = await call('POST', `/${cards[1].id}`, { body: { value: VALUE } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'SECRET_EXISTS');
    assert.match(refused.body.error.message, /такой ключ уже есть/i);
    assert.equal(refused.raw.includes(VALUE), false);
    assert.match(await readFile(secretsFile, 'utf8'), /^TAKEN_KEY=old$/m);

    const declined = await call('POST', `/${cards[1].id}/decline`);
    assert.deepEqual(declined.body.data, { message: 'Дима отказал' });
    assert.equal((await taken).message, 'Дима отказал');
    assert.deepEqual((await call('GET', '/')).body.data.requests, []);
    assert.equal((await call('POST', `/${cards[1].id}/decline`)).status, 404);

    assert.equal(JSON.stringify(frames).includes(VALUE), false);
    assert.ok(frames.length >= 4);

    modOn = false;
    const off = await call('GET', '/');
    assert.equal(off.status, 409);
    assert.equal(off.body.error.code, 'MOD_OFF');
  } finally {
    server.close();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
