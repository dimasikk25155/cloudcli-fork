import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, uiPreferencesDb, userDb } from '@/modules/database/index.js';

test('the «Рабочий стол» layout is stored on the account as a JSON string', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ui-prefs-workbench-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  t.after(async () => {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const userId = Number(userDb.createUser('dima', 'hash').id);

  const layout = JSON.stringify({ enabled: true, ratio: 0.45 });
  uiPreferencesDb.updateUiPreferences(userId, { workbenchLayout: layout });
  assert.equal(uiPreferencesDb.getUiPreferences(userId).workbenchLayout, layout);
});
