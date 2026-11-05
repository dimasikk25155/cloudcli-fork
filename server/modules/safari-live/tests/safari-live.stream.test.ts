import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
// The stream key is derived from the app secret (never the app secret itself).
const STREAM_SECRET = createHmac('sha256', TEST_SECRET).update('neo3-safari-live-stream-v1').digest('base64url');
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
  const viewers = new Map<SafariViewer, string>();
  const restores: Array<{ url: string } | null> = [];
  let unsubscribed = 0;
  const service = {
    subscribe(pageId: string, viewer: SafariViewer, restore?: { url: string }) {
      viewers.set(viewer, pageId);
      restores.push(restore ?? null);
      return () => {
        if (viewers.delete(viewer)) unsubscribed += 1;
      };
    },
  } as unknown as SafariLiveService;
  return {
    service,
    viewers,
    restores,
    unsubscribed: () => unsubscribed,
    push: (jpeg: string) => { for (const viewer of viewers.keys()) viewer.onFrame(Buffer.from(jpeg)); },
    end: (how: 'page_gone' | 'error' | 'stopped' = 'page_gone') => { for (const viewer of [...viewers.keys()]) viewer.onEnd(how); },
  };
}

async function withServer(
  modOn: (userId: unknown) => boolean,
  run: (base: string, fake: ReturnType<typeof fakeService>) => Promise<void>,
  notify?: (userId: number, sessionId: string) => void,
  restoreUrl?: (payload: { userId: number; pageId: string; sessionId?: string }) => string | null,
) {
  const fake = fakeService();
  const app = express();
  app.get('/sl/:token/stream', createSafariLiveStreamHandler({ service: fake.service, modOn, notify, restoreUrl }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, fake);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

test('stream token: round-trips user and page; another scope, another secret or an expired token is refused', () => {
  const token = signStreamToken({ userId: 1, pageId: 'p345' });
  assert.deepEqual(readStreamToken(token), { userId: 1, pageId: 'p345' });

  const decoded = jwt.decode(token) as { exp: number; iat: number; scope: string };
  assert.equal(decoded.scope, 'safari-live');
  assert.equal(decoded.exp - decoded.iat, 600);

  // A hand-made link with the right key is read (the expected key comes from the derivation rule, not the code).
  assert.deepEqual(readStreamToken(jwt.sign({ scope: 'safari-live', viewer: 3, page: 'p9' }, STREAM_SECRET)), { userId: 3, pageId: 'p9' });
  assert.equal(readStreamToken(jwt.sign({ scope: 'autopilot-dashboard', viewer: 1, page: 'p345' }, STREAM_SECRET)), null);
  assert.equal(readStreamToken(jwt.sign({ scope: 'safari-live', viewer: 1, page: 'p345' }, 'other-secret')), null);
  assert.equal(readStreamToken(jwt.sign({ scope: 'safari-live', viewer: 1, page: 'p345' }, TEST_SECRET)), null, 'the app secret itself does not sign links');
  assert.equal(readStreamToken(jwt.sign({ scope: 'safari-live', viewer: 1, page: 'p345', exp: Math.floor(Date.now() / 1000) - 5 }, STREAM_SECRET)), null);
  // The link carries no `userId`, so the login check has nothing to take even if it trusted the signature.
  assert.equal((jwt.decode(token) as Record<string, unknown>).userId, undefined);
  assert.equal(readStreamToken('garbage'), null);
});

test('GET /sl/:token/stream: bad token → 401, mod off → 409, nothing subscribed', async () => {
  await withServer((userId) => userId !== 2, async (base, fake) => {
    const bad = await fetch(`${base}/sl/not-a-token/stream`);
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('content-type') ?? '', /text\/plain/);

    const expired = jwt.sign({ scope: 'safari-live', viewer: 1, page: 'p1', exp: Math.floor(Date.now() / 1000) - 5 }, STREAM_SECRET);
    assert.equal((await fetch(`${base}/sl/${expired}/stream`)).status, 401);

    const modOff = await fetch(`${base}/sl/${signStreamToken({ userId: 2, pageId: 'p9' })}/stream`);
    assert.equal(modOff.status, 409);
    assert.equal(fake.viewers.size, 0);
  });
});

test('GET /sl/:token/stream: multipart JPEG parts for the token page; stream end closes the response', async () => {
  await withServer(() => true, async (base, fake) => {
    const token = signStreamToken({ userId: 1, pageId: 'p345' });
    const body = await new Promise<{ headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      http.get(`${base}/sl/${token}/stream`, (response) => {
        let text = '';
        response.setEncoding('latin1');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ headers: response.headers, text }));
      }).on('error', reject);
      void (async () => {
        await waitFor(() => fake.viewers.size > 0, 'a viewer');
        assert.deepEqual([...fake.viewers.values()], ['p345']);
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
    const response = await fetch(`${base}/sl/${signStreamToken({ userId: 1, pageId: 'p7' })}/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    await waitFor(() => fake.viewers.size > 0, 'a viewer');
    controller.abort();
    await waitFor(() => fake.unsubscribed() > 0, 'the unsubscribe');
    assert.equal(fake.unsubscribed(), 1);
    assert.equal(fake.viewers.size, 0);
  });
});

test('GET /sl/:token/stream: when the picture ends by itself (page closed, helper died) the chat of the link is pinged, not when stopped or the viewer leaves', async () => {
  const pings: Array<[number, string]> = [];
  await withServer(() => true, async (base, fake) => {
    for (const how of ['page_gone', 'error', 'stopped'] as const) {
      const response = await fetch(`${base}/sl/${signStreamToken({ userId: 1, pageId: 'p345', sessionId: `chat-${how}` })}/stream`);
      await waitFor(() => fake.viewers.size > 0, 'a viewer');
      fake.end(how);
      await response.text();
    }
    const controller = new AbortController();
    await fetch(`${base}/sl/${signStreamToken({ userId: 1, pageId: 'p7', sessionId: 'chat-left' })}/stream`, { signal: controller.signal });
    await waitFor(() => fake.viewers.size > 0, 'a viewer');
    controller.abort();
    await waitFor(() => fake.unsubscribed() > 0, 'the unsubscribe');
    // a link without a chat (older tab) ends silently
    const old = await fetch(`${base}/sl/${signStreamToken({ userId: 1, pageId: 'p8' })}/stream`);
    await waitFor(() => fake.viewers.size > 0, 'a viewer');
    fake.end('page_gone');
    await old.text();
  }, (userId, sessionId) => { pings.push([userId, sessionId]); });
  assert.deepEqual(pings, [[1, 'chat-page_gone'], [1, 'chat-error']]);
  assert.equal(readStreamToken(signStreamToken({ userId: 2, pageId: 'p9', sessionId: 's' }))?.sessionId, 's');
});

test('GET /sl/:token/stream: the chat of the link gives the restore address for its page (never another page)', async () => {
  const asked: Array<{ pageId: string; sessionId?: string }> = [];
  await withServer(() => true, async (base, fake) => {
    for (const payload of [{ userId: 1, pageId: 'chat-s1', sessionId: 's1' }, { userId: 1, pageId: 'chat-other', sessionId: 's1' }]) {
      const controller = new AbortController();
      await fetch(`${base}/sl/${signStreamToken(payload)}/stream`, { signal: controller.signal });
      await waitFor(() => fake.viewers.size > 0, 'a viewer');
      controller.abort();
      await waitFor(() => fake.viewers.size === 0, 'gone');
    }
    assert.deepEqual(fake.restores, [{ url: 'https://example.com/last' }, null]);
  }, undefined, (payload) => {
    asked.push({ pageId: payload.pageId, sessionId: payload.sessionId });
    return payload.pageId === 'chat-s1' ? 'https://example.com/last' : null;
  });
  assert.deepEqual(asked, [{ pageId: 'chat-s1', sessionId: 's1' }, { pageId: 'chat-other', sessionId: 's1' }]);
});
