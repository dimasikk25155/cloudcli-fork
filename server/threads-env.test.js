import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from './claude-sdk.js';
import { buildGrokSpawnEnv } from './grok-cli.js';
import { buildCodexClientOptions } from './openai-codex.js';
import { threadsApiUrl } from './shared/threads-env.js';

// R14 (story 24): the thread token of a run reaches the engine process — and
// from there its stdio MCP servers — for Claude (sdkOptions.env), Grok (spawn
// env) and Codex (SDK env). A run without a token never carries one, not even
// one inherited from the environment Neo3 itself was started in.

const effortModels = { OPTIONS: [], DEFAULT: 'opus[1m]' };
const runEnv = {
  NEO3_THREADS_TOKEN: '1f'.repeat(32),
  NEO3_THREADS_API_URL: 'http://127.0.0.1:3999/api/threads',
};

function withInheritedToken(runTest) {
  const previous = {
    token: process.env.NEO3_THREADS_TOKEN,
    url: process.env.NEO3_THREADS_API_URL,
    probe: process.env.NEO3_TEST_PASSTHROUGH,
  };
  process.env.NEO3_THREADS_TOKEN = 'outer-run-token';
  process.env.NEO3_THREADS_API_URL = 'http://127.0.0.1:1/api/threads';
  process.env.NEO3_TEST_PASSTHROUGH = 'kept';
  try {
    runTest();
  } finally {
    for (const [name, value] of [
      ['NEO3_THREADS_TOKEN', previous.token],
      ['NEO3_THREADS_API_URL', previous.url],
      ['NEO3_TEST_PASSTHROUGH', previous.probe],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('Claude: the run token and the API address are in the CLI env', () => {
  const { env } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels, threadsEnv: runEnv });
  assert.equal(env.NEO3_THREADS_TOKEN, runEnv.NEO3_THREADS_TOKEN);
  assert.equal(env.NEO3_THREADS_API_URL, runEnv.NEO3_THREADS_API_URL);
  assert.equal(env.NEO3_SESSION, '1');
});

test('Claude: the token survives the local-model engine route', () => {
  const { env } = mapCliOptionsToSDK({ model: 'local-qwen35-9b', effortModels, threadsEnv: runEnv });
  assert.equal(env.NEO3_THREADS_TOKEN, runEnv.NEO3_THREADS_TOKEN);
});

test('Claude: a run without a token carries none, not even an inherited one', () => {
  withInheritedToken(() => {
    const { env } = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels });
    assert.equal(env.NEO3_THREADS_TOKEN, undefined);
    assert.equal(env.NEO3_THREADS_API_URL, undefined);
    assert.equal(env.NEO3_TEST_PASSTHROUGH, 'kept');
  });
});

test('Grok: the run token is in the spawn env next to the hooks switch', () => {
  const env = buildGrokSpawnEnv({ threadsEnv: runEnv });
  assert.equal(env.NEO3_THREADS_TOKEN, runEnv.NEO3_THREADS_TOKEN);
  assert.equal(env.NEO3_THREADS_API_URL, runEnv.NEO3_THREADS_API_URL);
  assert.equal(env.GROK_CLAUDE_HOOKS_ENABLED, '0');
});

test('Grok: no token → none in the spawn env, host env kept', () => {
  withInheritedToken(() => {
    const env = buildGrokSpawnEnv({});
    assert.equal(env.NEO3_THREADS_TOKEN, undefined);
    assert.equal(env.NEO3_TEST_PASSTHROUGH, 'kept');
  });
});

test('Codex: the SDK gets an env with the run token and the host env', () => {
  withInheritedToken(() => {
    const options = buildCodexClientOptions({ threadsEnv: runEnv }, { instructions: 'rules' });
    assert.equal(options.env.NEO3_THREADS_TOKEN, runEnv.NEO3_THREADS_TOKEN);
    assert.equal(options.env.NEO3_THREADS_API_URL, runEnv.NEO3_THREADS_API_URL);
    assert.equal(options.env.NEO3_TEST_PASSTHROUGH, 'kept');
    assert.equal(options.env.PATH, process.env.PATH);
    assert.equal(options.config.developer_instructions, 'rules');
    assert.ok(Object.values(options.env).every((value) => typeof value === 'string'));
  });
});

test('Codex: no token → none in the SDK env', () => {
  withInheritedToken(() => {
    const options = buildCodexClientOptions({}, { instructions: 'rules' });
    assert.equal(options.env.NEO3_THREADS_TOKEN, undefined);
    assert.equal(options.env.NEO3_THREADS_API_URL, undefined);
  });
});

test('the API address follows the server bind: a concrete HOST as is, wildcard/loopback → 127.0.0.1', () => {
  assert.equal(threadsApiUrl({ host: '100.96.100.39', port: '3005' }), 'http://100.96.100.39:3005/api/threads');
  assert.equal(threadsApiUrl({ host: '0.0.0.0', port: 3417 }), 'http://127.0.0.1:3417/api/threads');
  assert.equal(threadsApiUrl({ host: undefined, port: undefined }), 'http://127.0.0.1:3001/api/threads');
  assert.equal(threadsApiUrl({ host: 'localhost', port: '3005' }), 'http://127.0.0.1:3005/api/threads');
  assert.equal(threadsApiUrl({ host: 'fd7a::1', port: '3005' }), 'http://[fd7a::1]:3005/api/threads');
});

test('threads switched off: every engine gets the «off» marker and no token, not even an inherited one', () => {
  const off = { NEO3_THREADS_OFF: '1' };
  withInheritedToken(() => {
    const claude = mapCliOptionsToSDK({ model: 'opus[1m]', effortModels, threadsEnv: off }).env;
    const grok = buildGrokSpawnEnv({ threadsEnv: off });
    const codex = buildCodexClientOptions({ threadsEnv: off }, { instructions: 'rules' }).env;
    for (const env of [claude, grok, codex]) {
      assert.equal(env.NEO3_THREADS_OFF, '1');
      assert.equal(env.NEO3_THREADS_TOKEN, undefined);
      assert.equal(env.NEO3_THREADS_API_URL, undefined);
    }
  });
});
