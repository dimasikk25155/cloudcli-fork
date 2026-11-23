import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVoiceBackendFetch, isPrivateHost, PROXY_STICKY_MS, resolveVoiceProxyUrl } from './voice-route.js';

const GROQ = new URL('https://api.groq.com/openai/v1/audio/transcriptions');
const BRIDGE = { bridge: true };

function harness({ direct, bridge, clock = { t: 0 } }) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = options.dispatcher ? 'bridge' : 'direct';
    calls.push(route);
    const outcome = route === 'bridge' ? bridge() : direct();
    if (outcome instanceof Error) throw outcome;
    return new Response('', { status: outcome });
  };
  const run = createVoiceBackendFetch({ fetchImpl, proxyUrl: 'http://127.0.0.1:12809', getDispatcher: async () => BRIDGE, now: () => clock.t });
  return { calls, run: () => run(GROQ, { method: 'POST', body: 'x' }), clock };
}

test('VOICE_PROXY_URL: unset is the bridge, off disables, a URL is kept', () => {
  assert.equal(resolveVoiceProxyUrl(undefined), 'http://127.0.0.1:12809');
  assert.equal(resolveVoiceProxyUrl('off'), '');
  assert.equal(resolveVoiceProxyUrl('http://10.0.0.1:3128'), 'http://10.0.0.1:3128');
});

test('local, private and Tailscale backends are never sent through the bridge', () => {
  for (const host of ['localhost', '127.0.0.1', '192.168.0.5', '10.1.2.3', '172.20.0.1', '100.98.152.66', 'box.ts.net', '::1']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['api.groq.com', '8.6.112.0', '172.32.0.1', '100.128.0.1']) assert.equal(isPrivateHost(host), false, host);
});

test('a working direct route is used as is', async () => {
  const h = harness({ direct: () => 200, bridge: () => 200 });
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.calls, ['direct']);
});

test('Groq refusing the country (403) is retried through the bridge, which is then used first', async () => {
  const h = harness({ direct: () => 403, bridge: () => 200 });
  assert.equal((await h.run()).status, 200);
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.calls, ['direct', 'bridge', 'bridge']);
});

test('after the sticky window the direct route is tried again', async () => {
  const h = harness({ direct: () => 403, bridge: () => 200 });
  await h.run();
  h.clock.t = PROXY_STICKY_MS + 1;
  await h.run();
  assert.deepEqual(h.calls, ['direct', 'bridge', 'direct', 'bridge']);
});

test('a network failure on the direct route falls back to the bridge', async () => {
  const h = harness({ direct: () => new TypeError('fetch failed'), bridge: () => 200 });
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.calls, ['direct', 'bridge']);
});

test('a dead bridge returns the original direct answer, and a failing sticky bridge yields to direct', async () => {
  const dead = harness({ direct: () => 403, bridge: () => new TypeError('ECONNREFUSED') });
  assert.equal((await dead.run()).status, 403);

  let bridgeUp = true;
  const h = harness({ direct: () => (bridgeUp ? 403 : 200), bridge: () => (bridgeUp ? 200 : new TypeError('ECONNREFUSED')) });
  await h.run();
  bridgeUp = false;
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.calls, ['direct', 'bridge', 'bridge', 'direct']);
});

test('without a proxy configured, or for a private host, there is one direct call only', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => { calls.push(options.dispatcher ? 'bridge' : 'direct'); return new Response('', { status: 403 }); };
  const off = createVoiceBackendFetch({ fetchImpl, proxyUrl: '', getDispatcher: async () => BRIDGE });
  assert.equal((await off(GROQ, {})).status, 403);
  const on = createVoiceBackendFetch({ fetchImpl, proxyUrl: 'http://127.0.0.1:12809', getDispatcher: async () => BRIDGE });
  assert.equal((await on(new URL('http://100.98.152.66:8000/v1/audio/transcriptions'), {})).status, 403);
  assert.deepEqual(calls, ['direct', 'direct']);
});
