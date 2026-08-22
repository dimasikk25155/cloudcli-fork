// Guards the agent API provider whitelist.
//
// Two engine ports in a row shipped with the new engine missing from this list:
// the route answered 400 "provider must be ..." while every other layer already
// knew the engine. Types cannot catch it (plain string), so a test does.
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAgentRun } from '../agent.js';
import { SUPPORTED_PROVIDERS, isSupportedProvider } from '../../shared/providers.js';

const createResponse = () => {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    headers: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      res.headersSent = true;
      return res;
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
  };
  return res;
};

const runRoute = async (body) => {
  const res = createResponse();
  await handleAgentRun({ body, user: { id: 1 } }, res);
  return res;
};

test('every shipped engine is accepted by the agent API', () => {
  for (const provider of ['claude', 'cursor', 'codex', 'opencode', 'kimi', 'gemini', 'grok']) {
    assert.ok(
      SUPPORTED_PROVIDERS.includes(provider),
      `${provider} dropped out of SUPPORTED_PROVIDERS`,
    );
    assert.ok(isSupportedProvider(provider), `${provider} rejected by isSupportedProvider`);
  }
});

test('agent route rejects an unknown provider and names the supported ones', async () => {
  const res = await runRoute({
    projectPath: '/tmp',
    message: 'hi',
    provider: 'not-an-engine',
    stream: false,
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /^provider must be one of: /);
  assert.match(res.body.error, /grok/);
});

test('agent route lets grok past the whitelist', async () => {
  const res = await runRoute({
    projectPath: '/definitely/missing/path/for/grok/whitelist/test',
    message: 'hi',
    provider: 'grok',
    stream: false,
  });

  // The run still fails — the project path is fake — but it must fail *after*
  // provider validation, i.e. with a different error than the 400 above.
  assert.doesNotMatch(String(res.body.error), /provider must be/);
  assert.match(String(res.body.error), /Project path does not exist/);
});

test('unattended runs share the same whitelist as the agent API', async () => {
  const { SUPPORTED_PROVIDERS: unattended } = await import(
    '../../modules/agent-run/agent-run.service.js'
  );
  assert.deepEqual(unattended, SUPPORTED_PROVIDERS);
});
