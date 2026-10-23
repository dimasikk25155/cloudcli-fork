import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import secretsStashRoutes from '../../../modules/secrets-stash/secrets-stash.routes.js';
// The HTTP face of the stash: what comes back must be the name and nothing
// else — never the value, not even inside an error.
const FAKE = 'sk-ant-api03-FakeFakeFakeFakeFakeFakeFake0000';
test('POST /api/secrets/stash answers {name} only and never echoes the value', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neo3-stash-route-'));
    const previous = process.env.NEO3_SECRETS_FILE;
    process.env.NEO3_SECRETS_FILE = path.join(dir, '.secrets.env');
    const app = express();
    app.use(express.json());
    // Same chain as server/index.js, with the auth pair stubbed by header.
    app.use('/api/secrets', (req, res, next) => (req.headers.authorization ? next() : res.sendStatus(401)), (req, res, next) => (req.headers.authorization === 'admin' ? next() : res.sendStatus(403)), secretsStashRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        if (previous === undefined)
            delete process.env.NEO3_SECRETS_FILE;
        else
            process.env.NEO3_SECRETS_FILE = previous;
        await fs.rm(dir, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}/api/secrets/stash`;
    const post = (role, body) => fetch(url, {
        method: 'POST',
        headers: { Authorization: role, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    assert.equal((await post('member', { name: 'ANTHROPIC_API_KEY', value: FAKE })).status, 403);
    await assert.rejects(fs.stat(process.env.NEO3_SECRETS_FILE), 'a non-admin request writes nothing');
    const ok = await post('admin', { name: 'ANTHROPIC_API_KEY', value: FAKE });
    assert.equal(ok.status, 200);
    const okText = await ok.text();
    assert.deepEqual(JSON.parse(okText), { name: 'ANTHROPIC_API_KEY' });
    assert.ok(!okText.includes(FAKE));
    const bad = await post('admin', { name: 'bad name', value: FAKE });
    assert.equal(bad.status, 400);
    assert.ok(!(await bad.text()).includes(FAKE));
});
//# sourceMappingURL=secrets-stash.routes.test.js.map