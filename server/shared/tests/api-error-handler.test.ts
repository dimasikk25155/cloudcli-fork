import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { apiErrorHandler } from '../utils.js';

// A fake of a plausible shape: the point is that it never shows up in a log.
const VALUE = 'sk_FakeBrokenBodyValue_0123456789';

/** Everything console.error prints while `run` works (errors with their message, stack and own fields). */
async function captureErrors<T>(run: () => Promise<T>): Promise<{ result: T; printed: string }> {
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => {
      if (arg instanceof Error) return `${arg.message} ${arg.stack} ${JSON.stringify({ ...arg })}`;
      return typeof arg === 'string' ? arg : JSON.stringify(arg);
    }).join(' '));
  };
  try {
    const result = await run();
    return { result, printed: lines.join('\n') };
  } finally {
    console.error = saved;
  }
}

/** The production order: JSON body parser → routes → `apiErrorHandler` last. */
async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  const secretRequests = express.Router();
  secretRequests.post('/:id', (_req, res) => { res.json({ reached: true }); });
  app.use('/api/secret-requests', secretRequests);
  app.get('/api/boom', () => { throw new Error('plain failure for the log'); });
  app.use(apiErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a broken JSON body is a 400 and the raw body (a key value) never reaches the log or the answer', async () => {
  await withApp(async (base) => {
    const { result: response, printed } = await captureErrors(() => fetch(`${base}/api/secret-requests/req-1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"value":"${VALUE}`,
    }));
    assert.equal(response.status, 400);
    const raw = await response.text();
    assert.ok(!raw.includes(VALUE), 'the answer does not echo the body');
    assert.equal(JSON.parse(raw).error.code, 'INVALID_JSON');
    assert.ok(!printed.includes(VALUE), 'the log does not carry the body');
    assert.ok(!printed.includes('FakeBrokenBody'), 'not even a piece of it');
  });
});

test('other errors are still logged as before and answer 500', async () => {
  await withApp(async (base) => {
    const { result: response, printed } = await captureErrors(() => fetch(`${base}/api/boom`));
    assert.equal(response.status, 500);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
    assert.match(printed, /plain failure for the log/);
  });
});
