import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, uiPreferencesDb, userDb } from '@/modules/database/index.js';
import { createIsModOn, isModOn } from '@/shared/mods.js';

import { MODS, MOD_KEYS, modDefault } from '../../../shared/mods.js';

// The twenty-three keys written out by hand; `subagentCrabs` keeps its old name.
const EXPECTED_KEYS = [
  'modAttention',
  'modAnswerButtons',
  'modReplyChips',
  'modSecretGuard',
  'modMemoryNotes',
  'modCodeStatus',
  'modRelay',
  'modBackgroundConsole',
  'modThreads',
  'subagentCrabs',
  'modScreenshots',
  'modCacheTimer',
  'modKrabikAgent',
  'modDuet',
  'modImprovementIdeas',
  'modWorkbench',
  'modSessionHub',
  'modSideChat',
  'modGroups',
  'modThinkingTime',
  'modKeepAwake',
  'modDiagnostics',
  'modArtifactEditor',
];

// Mods of the workbench build (04.11.2026): each card says how it works in every engine.
const WORKBENCH_BUILD_KEYS = [
  'modWorkbench',
  'modSessionHub',
  'modSideChat',
  'modGroups',
  'modThinkingTime',
  'modKeepAwake',
  'modDiagnostics',
  'modArtifactEditor',
];

test('the mod registry lists exactly the twenty-three mods, each with a title and a description', () => {
  assert.deepEqual([...MOD_KEYS].sort(), [...EXPECTED_KEYS].sort());
  assert.equal(MODS.length, 23);
  for (const mod of MODS) {
    assert.ok(mod.title.trim().length > 0, `${mod.key} has a title`);
    assert.ok(mod.description.trim().length > 0, `${mod.key} has a description`);
    assert.equal(modDefault(mod.key), true, `${mod.key} is on by default`);
  }
});

test('every mod of the workbench build names its support in Claude, Codex and Grok', () => {
  for (const key of WORKBENCH_BUILD_KEYS) {
    const mod = MODS.find((candidate) => candidate.key === key);
    assert.ok(mod, `${key} has a card`);
    const engines = mod.engines ?? '';
    for (const engine of ['Claude', 'Codex', 'Grok']) {
      assert.ok(engines.includes(engine), `${key}: the engines line mentions ${engine}`);
    }
  }
});

test('answer buttons need «Ждут тебя», artifact editing needs «Рабочий стол»; no other mod depends on another', () => {
  const withRequires = MODS.filter((mod) => mod.requires);
  assert.deepEqual(withRequires.map((mod) => [mod.key, mod.requires]).sort(), [
    ['modAnswerButtons', 'modAttention'],
    ['modArtifactEditor', 'modWorkbench'],
  ]);
});

test('«Правка артефактов» card: title and support in all three engines', () => {
  const mod = MODS.find((candidate) => candidate.key === 'modArtifactEditor');
  assert.ok(mod, 'modArtifactEditor has a card');
  assert.equal(mod.title, 'Правка артефактов');
  assert.equal(mod.engines, 'Claude ✓ · Codex ✓ · Grok ✓');
});

test('isModOn: on until the user switches it off, and only for that user', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'is-mod-on-'));
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
  const dima = Number(userDb.createUser('dima', 'hash').id);
  const friend = Number(userDb.createUser('friend', 'hash').id);

  // Nothing stored yet → on.
  assert.equal(isModOn(dima, 'modRelay'), true);
  // No user (system run) → on.
  assert.equal(isModOn(null, 'modRelay'), true);
  assert.equal(isModOn(undefined, 'modRelay'), true);

  uiPreferencesDb.updateUiPreferences(dima, { modRelay: false });
  assert.equal(isModOn(dima, 'modRelay'), false);
  // Other mods of the same user and the same mod of another user stay on.
  assert.equal(isModOn(dima, 'modThreads'), true);
  assert.equal(isModOn(friend, 'modRelay'), true);

  uiPreferencesDb.updateUiPreferences(dima, { modRelay: true });
  assert.equal(isModOn(dima, 'modRelay'), true);
});

test('isModOn: a failed read of the settings leaves the mod on', () => {
  const failingIsModOn = createIsModOn(() => {
    throw new Error('database is locked');
  });
  assert.equal(failingIsModOn(1, 'modAttention'), true);
});
