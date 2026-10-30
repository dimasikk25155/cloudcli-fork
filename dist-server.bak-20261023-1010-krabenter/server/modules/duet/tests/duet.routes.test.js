import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createDuetRouter } from '../../../modules/duet/duet.routes.js';
test('/api/duet: решения, отказ 409 и MOD_OFF при выключенном моде', async (t) => {
    const calls = [];
    let modOn = true;
    const fake = {
        view: async () => ({ services: [], decisions: [] }),
        check: async () => {
            calls.push('check');
        },
        requestBrief: (kind) => {
            calls.push(`brief:${kind}`);
        },
        decide: async (id, choice) => {
            calls.push(`decide:${id}:${choice}`);
            return id === 'ok' ? { ok: true, decision: { id } } : { ok: false, reason: 'already_decided' };
        },
    };
    const app = express();
    app.use(express.json());
    app.use('/api/duet', createDuetRouter(async () => fake, () => modOn));
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/api/duet`;
    assert.equal((await fetch(`${base}/check`, { method: 'POST' })).status, 200);
    assert.deepEqual(calls, ['check', 'brief:manual']);
    assert.equal((await fetch(`${base}/decisions/ok/restart`, { method: 'POST' })).status, 200);
    const refused = await fetch(`${base}/decisions/old/fix`, { method: 'POST' });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error.message, 'Уже решено');
    assert.equal((await fetch(`${base}/decisions/ok/rm`, { method: 'POST' })).status, 400);
    modOn = false;
    const off = await fetch(`${base}/state`);
    assert.equal(off.status, 409);
    assert.equal((await off.json()).error.code, 'MOD_OFF');
});
//# sourceMappingURL=duet.routes.test.js.map