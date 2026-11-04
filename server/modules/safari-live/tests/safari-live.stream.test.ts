import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import jwt from 'jsonwebtoken';

import type { SafariLiveService, SafariViewer } from '@/modules/safari-live/index.js';

// The stream link carries a short JWT signed with the app secret; set it before
// the auth module is loaded so the test never touches a database.
const TEST_SECRET = 'safari-live-stream-test-secret-0123456789';
process.env.JWT_SECRET = TEST_SECRET;
const { signStreamToken, readStreamToken, createSafariLiveStreamHandler } = await import('@/modules/safari-live/index.js');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, what: string, ms = 3_000): Promise<void> {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function fakeService() {
  const viewers = new Map<SafariViewer, number>();
  let unsubscribed = 0;
  const service = {
    subscribe(windowId: number, viewer: SafariViewer) {
      viewers.set(viewer, windowId);
      return () => {
        if (viewers.delete(viewer)) unsubscribed += 1;
      };
    },
  } as unknown as SafariLiveService;
  return {
    service,
    viewers,
    unsubscribed: () => unsubscribed,
    push: (jpeg: string) => { for (const viewer of viewers.keys()) viewer.onFrame(Buffer.from(jpeg)); },
    end: () => { for (const viewer of [...viewers.keys()]) viewer.onEnd('window_gone'); },
  };
}

async function withServer(modOn: (userId: unknown) => boolean, run: (base: string, fake: ReturnType<typeof fakeService>) => Promise<void>) {
  const fake = fakeService();
  const app = express();
  app.get('/sl/:token/stream', createSafariLiveStreamHandler({ service: fake.service, modOn }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, fake);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

test('stream token: round-trips user and window; another scope, another secret or an expired token is refused', () => {
  const token = signStreamToken({ userId: 1, windowId: 345 });
  assert.deepEqual(readStreamToken(token), { userId: 1, windowId: 345 });

  const decoded = jwt.decode(token) as { exp: number; iat: number; scope: string };
  assert.equal(decoded.scope, 'safari-live');
  assert.equal(decoded.exp - decoded.iat, 600);

  assert.equal(readStreamToken(jwt.sign({ scope: 'autopilot-dashboard', userId: 1, windowId: 345 }, TEST_SECRET)), null);
  assert.equal(readStreamToken(jwt.sign({ scope: 'safari-live', userId: 1, windowId: 345 }, 'other-secret')), null);
  assert.equal(readStreamToken(jwt.sign({ scope: 'safari-live', userId: 1, windowId: 345, exp: Math.floor(Date.now() / 1000) - 5 }, TEST_SECRET)), null);
  assert.equal(readStreamToken('garbage'), null);
});

test('GET /sl/:token/stream: bad token → 401, mod off → 409, nothing subscribed', async () => {
  await withServer((userId) => userId !== 2, async (base, fake) => {
    const bad = await fetch(`${base}/sl/not-a-token/stream`);
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('content-type') ?? '', /text\/plain/);

    const expired = jwt.sign({ scope: 'safari-live', userId: 1, windowId: 1, exp: Math.floor(Date.now() / 1000) - 5 }, TEST_SECRET);
    assert.equal((await fetch(`${base}/sl/${expired}/stream`)).status, 401);

    const modOff = await fetch(`${base}/sl/${signStreamToken({ userId: 2, windowId: 9 })}/stream`);
    assert.equal(modOff.status, 409);
    assert.equal(fake.viewers.size, 0);
  });
});

test('GET /sl/:token/stream: multipart JPEG parts for the token window; stream end closes the response', async () => {
  await withServer(() => true, async (base, fake) => {
    const token = signStreamToken({ userId: 1, windowId: 345 });
    const body = await new Promise<{ headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      http.get(`${base}/sl/${token}/stream`, (response) => {
        let text = '';
        response.setEncoding('latin1');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ headers: response.headers, text }));
      }).on('error', reject);
      void (async () => {
        await waitFor(() => fake.viewers.size > 0, 'a viewer');
        assert.deepEqual([...fake.viewers.values()], [345]);
        fake.push('JPEG-A');
        fake.push('JPEG-BB');
        await sleep(20);
        fake.end();
      })().catch(reject);
    });
    assert.equal(body.headers['content-type'], 'multipart/x-mixed-replace; boundary=neo3frame');
    assert.equal(body.headers['cache-control'], 'no-store');
    assert.equal(
      body.text,
      '--neo3frame\r\nContent-Type: image/jpeg\r\nContent-Length: 6\r\n\r\nJPEG-A\r\n'
      + '--neo3frame\r\nContent-Type: image/jpeg\r\nContent-Length: 7\r\n\r\nJPEG-BB\r\n',
    );
  });
});

test('GET /sl/:token/stream: the viewer is unsubscribed when the client goes away', async () => {
  await withServer(() => true, async (base, fake) => {
    const controller = new AbortController();
    const response = await fetch(`${base}/sl/${signStreamToken({ userId: 1, windowId: 7 })}/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    await waitFor(() => fake.viewers.size > 0, 'a viewer');
    controller.abort();
    await waitFor(() => fake.unsubscribed() > 0, 'the unsubscribe');
    assert.equal(fake.unsubscribed(), 1);
    assert.equal(fake.viewers.size, 0);
  });
});
