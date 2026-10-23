import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createKrabikRouter } from '../../../modules/krabik/krabik.routes.js';
function fakeService(calls) {
    return {
        getState: async () => ({ reachable: true, status: 'idle', title: 'Готов', completionSeq: 3 }),
        getMessages: async () => [{ id: '1', role: 'assistant', text: 'Привет', at: null }],
        sendPrompt: async (text) => {
            calls.push(`prompt:${String(text)}`);
        },
        stop: async () => {
            calls.push('stop');
        },
        wake: async () => 'ok',
        listReports: async () => [],
        readReport: async () => '',
    };
}
test('/api/krabik: работает при включённом моде и отвечает 409 MOD_OFF при выключенном', async (t) => {
    const calls = [];
    let modOn = true;
    const app = express();
    app.use(express.json());
    app.use('/api/krabik', createKrabikRouter(fakeService(calls), () => modOn));
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/api/krabik`;
    const state = (await (await fetch(`${base}/state`)).json());
    assert.equal(state.data.status, 'idle');
    assert.equal(state.data.messages[0].text, 'Привет');
    const sent = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Проверь ботов' }),
    });
    assert.equal(sent.status, 200);
    assert.deepEqual(calls, ['prompt:Проверь ботов']);
    modOn = false;
    const refused = await fetch(`${base}/stop`, { method: 'POST' });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error.code, 'MOD_OFF');
    assert.deepEqual(calls, ['prompt:Проверь ботов']);
});
//# sourceMappingURL=krabik.routes.test.js.map