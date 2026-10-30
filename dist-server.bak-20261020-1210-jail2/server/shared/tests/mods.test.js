import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, uiPreferencesDb, userDb } from '../../modules/database/index.js';
import { createIsModOn, isModOn } from '../../shared/mods.js';
import { MODS, MOD_KEYS, modDefault } from '../../../shared/mods.js';
// The twelve keys exactly as fixed in interfaces.md; `subagentCrabs` keeps its old name.
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
];
test('the mod registry lists exactly the twelve mods, each with a title and a description', () => {
    assert.deepEqual([...MOD_KEYS].sort(), [...EXPECTED_KEYS].sort());
    assert.equal(MODS.length, 12);
    for (const mod of MODS) {
        assert.ok(mod.title.trim().length > 0, `${mod.key} has a title`);
        assert.ok(mod.description.trim().length > 0, `${mod.key} has a description`);
        assert.equal(modDefault(mod.key), true, `${mod.key} is on by default`);
    }
});
test('answer buttons work only together with «Ждут тебя»; no other mod depends on another', () => {
    const withRequires = MODS.filter((mod) => mod.requires);
    assert.deepEqual(withRequires.map((mod) => [mod.key, mod.requires]), [['modAnswerButtons', 'modAttention']]);
});
test('isModOn: on until the user switches it off, and only for that user', async (t) => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), 'is-mod-on-'));
    const previousDatabasePath = process.env.DATABASE_PATH;
    t.after(async () => {
        closeConnection();
        if (previousDatabasePath === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previousDatabasePath;
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
//# sourceMappingURL=mods.test.js.map