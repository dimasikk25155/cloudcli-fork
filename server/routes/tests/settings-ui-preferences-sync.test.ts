import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase, uiPreferencesDb, userDb } from '@/modules/database/index.js';
import { clientIdentities } from '@/modules/websocket/services/project-access.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

import settingsRoutes from '../settings.js';

class Client {
  readyState = 1;
  frames: string[] = [];
  send(payload: string) { this.frames.push(payload); }
}

// Mounts the real settings router the way server/index.js does, with only the JWT stubbed.
test('saving settings pings the user\'s other devices; a failed save pings nobody', async (t) => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ui-prefs-sync-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const dima = Number(userDb.createUser('dima', 'x').id);
  const friend = Number(userDb.createUser('friend', 'x').id);

  const phone = new Client();
  const friendTab = new Client();
  clientIdentities.set(phone, { id: dima });
  clientIdentities.set(friendTab, { id: friend });
  connectedClients.add(phone);
  connectedClients.add(friendTab);

  const app = express();
  app.use(express.json());
  app.use('/api/settings', (req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { id: Number(req.headers['x-user-id']) };
    next();
  }, settingsRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings`;

  const originalUpdate = uiPreferencesDb.updateUiPreferences;
  t.after(async () => {
    uiPreferencesDb.updateUiPreferences = originalUpdate;
    connectedClients.delete(phone);
    connectedClients.delete(friendTab);
    await new Promise((resolve) => server.close(resolve));
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  const put = (body: unknown) => fetch(`${base}/ui-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-user-id': String(dima) },
    body: JSON.stringify(body),
  });

  const saved = await put({ modRelay: false });
  assert.equal(saved.status, 200);
  assert.equal(uiPreferencesDb.getUiPreferences(dima).modRelay, false);
  assert.deepEqual(phone.frames.map((frame) => JSON.parse(frame)), [{ kind: 'ui_preferences_changed' }]);
  assert.deepEqual(friendTab.frames, []);

  phone.frames.length = 0;
  uiPreferencesDb.updateUiPreferences = () => {
    throw new Error('disk full');
  };
  const failed = await put({ modRelay: true });
  assert.equal(failed.status, 500);
  assert.deepEqual(phone.frames, []);
});
