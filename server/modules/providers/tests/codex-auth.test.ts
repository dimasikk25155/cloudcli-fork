import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexProviderAuth } from '../list/codex/codex-auth.provider.js';

const installed = () => ({ executablePath: '/fixture/codex', pathDirs: [] });

test('Codex auth uses native account metadata, including keychain and external providers', async () => {
  for (const [account, requiresOpenaiAuth, authenticated, method] of [
    [{ type: 'chatgpt', email: 'fixture@example.invalid' }, true, true, 'chatgpt'],
    [{ type: 'apiKey' }, true, true, 'api_key'],
    [null, false, true, 'external_provider'],
    [null, true, false, null],
  ] as const) {
    const provider = new CodexProviderAuth(async () => ({ account, requiresOpenaiAuth }), installed);
    const result = await provider.getStatus();
    assert.equal(result.installed, true);
    assert.equal(result.authenticated, authenticated);
    assert.equal(result.method, method);
    assert.equal(JSON.stringify(result).includes('access_token'), false);
  }
});

test('missing SDK binary and failed account RPC never claim valid authentication', async () => {
  const absent = new CodexProviderAuth(async () => { throw new Error('must not call'); }, () => { throw new Error('absent'); });
  assert.equal((await absent.getStatus()).installed, false);
  for (const read of [async () => null, async () => ({}), async () => { throw new Error('unavailable'); }]) {
    const status = await new CodexProviderAuth(read, installed).getStatus();
    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.match(status.error!, /Unable to read/);
  }
});
