import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { stashSecret } from '../../../modules/secrets-stash/secrets-stash.service.js';
// The stash writes into Dima's real key file in production, so every check
// here runs against a throwaway file. Values are fakes of a plausible shape.
const FAKE_A = 'ghp_FakeFakeFakeFakeFakeFakeFake000001';
const FAKE_B = 'ghp_FakeFakeFakeFakeFakeFakeFake000002';
let dir;
let file;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-stash-'));
    file = path.join(dir, '.secrets.env');
});
afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});
describe('secrets stash', () => {
    it('creates the file with mode 600 and a NAME=value line', async () => {
        const result = await stashSecret({ name: 'GITHUB_TOKEN', value: FAKE_A }, { file });
        assert.deepEqual(result, { name: 'GITHUB_TOKEN' });
        assert.equal(await fs.readFile(file, 'utf8'), `GITHUB_TOKEN=${FAKE_A}\n`);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    });
    it('a name taken by another value gets _2; the same value is reused without a write', async () => {
        await fs.writeFile(file, `# keys\nGITHUB_TOKEN=${FAKE_A}`, { mode: 0o640 });
        assert.deepEqual(await stashSecret({ name: 'GITHUB_TOKEN', value: FAKE_B }, { file }), { name: 'GITHUB_TOKEN_2' });
        const afterSecond = await fs.readFile(file, 'utf8');
        assert.equal(afterSecond, `# keys\nGITHUB_TOKEN=${FAKE_A}\nGITHUB_TOKEN_2=${FAKE_B}\n`);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o640, 'an existing file keeps its mode');
        assert.deepEqual(await stashSecret({ name: 'GITHUB_TOKEN', value: FAKE_A }, { file }), { name: 'GITHUB_TOKEN' });
        assert.deepEqual(await stashSecret({ name: 'GITHUB_TOKEN', value: FAKE_B }, { file }), { name: 'GITHUB_TOKEN_2' });
        assert.equal(await fs.readFile(file, 'utf8'), afterSecond, 'repeats must not append duplicates');
        assert.deepEqual((await fs.readdir(dir)).sort(), ['.secrets.env'], 'no temp files left behind');
    });
    it('values with spaces, quotes and newlines read back exactly', async () => {
        const tricky = "fake pass with 'quote' and $dollar";
        const pem = '-----BEGIN PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----';
        await stashSecret({ name: 'TRICKY', value: tricky }, { file });
        await stashSecret({ name: 'PEM', value: pem }, { file });
        // Same values again must be recognised as already stored.
        assert.deepEqual(await stashSecret({ name: 'TRICKY', value: tricky }, { file }), { name: 'TRICKY' });
        assert.deepEqual(await stashSecret({ name: 'PEM', value: pem }, { file }), { name: 'PEM' });
        assert.equal((await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).length, 2);
    });
    it('rejects bad names and empty values without echoing the value', async () => {
        for (const name of ['github_token', '1TOKEN', '_TOKEN', 'MY-TOKEN', '', 'ИМЯ']) {
            await assert.rejects(stashSecret({ name, value: FAKE_A }, { file }), (error) => !error.message.includes(FAKE_A) && /Имя/.test(error.message));
        }
        await assert.rejects(stashSecret({ name: 'EMPTY', value: '   ' }, { file }));
        await assert.rejects(fs.stat(file), 'nothing is written on a rejected request');
    });
    it('two concurrent stashes under one name keep both values', async () => {
        const results = await Promise.all([
            stashSecret({ name: 'RACE', value: FAKE_A }, { file }),
            stashSecret({ name: 'RACE', value: FAKE_B }, { file }),
        ]);
        assert.deepEqual(results.map((r) => r.name).sort(), ['RACE', 'RACE_2']);
        assert.equal(await fs.readFile(file, 'utf8'), `RACE=${FAKE_A}\nRACE_2=${FAKE_B}\n`);
    });
});
//# sourceMappingURL=secrets-stash.service.test.js.map