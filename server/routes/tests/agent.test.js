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

test('ResponseCollector: NormalizedMessage assistant text reaches the non-streaming answer', async () => {
  const { ResponseCollector } = await import('../agent.js');
  const collector = new ResponseCollector();

  collector.send({ kind: 'session_created', sessionId: 'grok-uuid-1', provider: 'grok' });
  collector.send({ kind: 'text', role: 'assistant', content: 'PONG', sessionId: 'grok-uuid-1', provider: 'grok' });
  collector.send({ kind: 'text', role: 'user', content: 'ping', sessionId: 'grok-uuid-1', provider: 'grok' });
  collector.send({ kind: 'complete', sessionId: 'grok-uuid-1', provider: 'grok' });

  const messages = collector.getAssistantMessages();
  // Every engine emits NormalizedMessage now; the legacy claude-response JSON
  // strings this used to look for no longer exist on the wire. Empty here is
  // the old "success with empty text" bug.
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.content[0].text, 'PONG');
  assert.equal(collector.getSessionId(), 'grok-uuid-1');
});

test('ResponseCollector: token_budget status feeds token totals without double-counting cache', async () => {
  const { ResponseCollector } = await import('../agent.js');
  const collector = new ResponseCollector();

  collector.send({
    kind: 'status',
    text: 'token_budget',
    provider: 'grok',
    sessionId: 'grok-uuid-2',
    // inputTokens already INCLUDES the cache tokens (see buildTokenBudget in
    // grok-sessions.provider.ts) — the collector must not add them twice.
    tokenBudget: {
      used: 1200, total: 500000, model: 'grok-4.6',
      inputTokens: 1000, outputTokens: 200,
      cacheReadTokens: 300, cacheCreationTokens: 100, cacheTokens: 400,
    },
  });

  const tokens = collector.getTotalTokens();
  assert.equal(tokens.inputTokens, 1000);
  assert.equal(tokens.outputTokens, 200);
  assert.equal(tokens.totalTokens, 1200);
});
