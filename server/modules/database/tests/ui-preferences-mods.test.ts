import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, uiPreferencesDb, userDb } from '@/modules/database/index.js';

test('the «Крабики-помощники» switch is stored on the account; unknown keys are not', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'ui-prefs-mods-'));
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
  const { id } = userDb.createUser('dima', 'hash');
  const userId = Number(id);

  uiPreferencesDb.updateUiPreferences(userId, { subagentCrabs: false, notAMod: true });
  assert.deepEqual(uiPreferencesDb.getUiPreferences(userId), { subagentCrabs: false });

  uiPreferencesDb.updateUiPreferences(userId, { subagentCrabs: true });
  assert.equal(uiPreferencesDb.getUiPreferences(userId).subagentCrabs, true);
});
