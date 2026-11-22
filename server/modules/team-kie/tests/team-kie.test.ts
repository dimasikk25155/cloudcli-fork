import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTeamKie, moscowDay, TEAM_KIE_NOT_ALLOWED, type TeamKieGrant } from '@/modules/team-kie/team-kie.service.js';

const KEY = 'kie-secret-key-123';

type Call = { url: string; method: string; auth: string | null; body: unknown };

/** Fake Kie: balance drops by `price` on every created task. */
function fakeKie(options: { balance?: number; price?: number; createCode?: number } = {}) {
  let balance = options.balance ?? 1000;
  const price = options.price ?? 4;
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null;
    calls.push({ url, method: init.method ?? 'GET', auth: headers.Authorization ?? null, body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const { pathname } = new URL(url);
    if (pathname === '/api/v1/chat/credit') return json({ code: 200, msg: 'success', data: balance });
    if (pathname === '/api/v1/jobs/createTask' || pathname === '/api/v1/veo/generate') {
      if (options.createCode && options.createCode !== 200) return json({ code: options.createCode, msg: 'insufficient credits' });
      balance -= price;
      return json({ code: 200, msg: 'success', data: { taskId: `task${calls.length}xyz` } });
    }
    if (pathname === '/api/v1/jobs/recordInfo') {
      return json({ code: 200, msg: 'success', data: { state: 'success', resultJson: '{"resultUrls":["https://tempfile.example/r.jpg"]}' } });
    }
    if (pathname === '/api/file-stream-upload') return json({ success: true, code: 200, data: { downloadUrl: 'https://tempfile.example/up.png' } });
    return new Response('nope', { status: 404 });
  };
  return { calls, fetchImpl, balance: () => balance };
}

function setup(config: unknown, kie = fakeKie(), now = () => new Date('2026-11-23T10:00:00Z')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-kie-'));
  if (config !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'team-kie-project-')));
  const users: Record<number, string> = { 2: 'slavik', 3: 'team' };
  const service = createTeamKie({
    grantFor: (token) => (token === 'run-token' ? { root, userId: 2 } : token === 'team-token' ? { root, userId: 3 } : null),
    usernameOf: (id) => users[id] ?? null,
    readKey: () => KEY,
    fetchImpl: kie.fetchImpl as never,
    dir,
    now,
  });
  return { service, dir, root, kie };
}

const rpc = (method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 1, method, params });

async function call(service: ReturnType<typeof setup>['service'], grant: TeamKieGrant, name: string, args: Record<string, unknown> = {}) {
  const reply = (await service.handle(grant, rpc('tools/call', { name, arguments: args }))) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
  return { isError: Boolean(reply.result.isError), text: reply.result.content[0].text };
}

test('an allowed teammate creates a task with the server key; spending is journaled', async () => {
  const { service, dir, kie } = setup({ users: ['Slavik'], dailyCredits: 100 });
  const grant = service.grantFor('run-token')!;

  const list = (await service.handle(grant, rpc('tools/list'))) as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['kie_balance', 'kie_create_task', 'kie_task_status', 'kie_upload_file']);

  const created = await call(service, grant, 'kie_create_task', {
    body: { model: 'grok-imagine/text-to-image', input: { prompt: 'tyre' }, callBackUrl: 'http://127.0.0.1:3005/evil' },
  });
  assert.equal(created.isError, false);
  const data = JSON.parse(created.text);
  assert.equal(data.credits, 4);
  assert.equal(data.spentToday, 4);
  assert.match(data.taskId, /^task/);

  const create = kie.calls.find((entry) => entry.url.endsWith('/api/v1/jobs/createTask'))!;
  assert.equal(create.auth, `Bearer ${KEY}`);
  assert.equal((create.body as Record<string, unknown>).callBackUrl, undefined, 'callbacks are stripped');

  // The key never reaches the agent.
  assert.ok(!created.text.includes(KEY));

  const ledger = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.days[moscowDay(new Date('2026-11-23T10:00:00Z'))].slavik, 4);
  assert.equal(ledger.entries[0].model, 'grok-imagine/text-to-image');

  const status = await call(service, grant, 'kie_task_status', { taskId: data.taskId });
  assert.equal(status.isError, false);
  assert.match(status.text, /resultUrls/);
});

test('the daily limit stops new tasks until Moscow midnight', async () => {
  let time = new Date('2026-11-23T10:00:00Z');
  const { service, kie } = setup({ users: ['slavik'], dailyCredits: 8 }, fakeKie({ price: 5 }), () => time);
  const grant = service.grantFor('run-token')!;
  const body = { model: 'm', input: {} };

  assert.equal((await call(service, grant, 'kie_create_task', { body })).isError, false); // 5
  assert.equal((await call(service, grant, 'kie_create_task', { body })).isError, false); // 10 — over after this one
  const refused = await call(service, grant, 'kie_create_task', { body });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /лимит/);
  assert.equal(kie.calls.filter((entry) => entry.url.endsWith('/createTask')).length, 2);

  // 21:30 UTC = 00:30 next day in Moscow → a fresh limit.
  time = new Date('2026-11-23T21:30:00Z');
  assert.equal((await call(service, grant, 'kie_create_task', { body })).isError, false);
});

test('parallel creations are measured one by one', async () => {
  const { service } = setup({ users: ['slavik'], dailyCredits: 1000 }, fakeKie({ price: 7 }));
  const grant = service.grantFor('run-token')!;
  const results = await Promise.all([1, 2, 3].map(() => call(service, grant, 'kie_create_task', { body: { model: 'm', input: {} } })));
  assert.deepEqual(results.map((result) => JSON.parse(result.text).credits), [7, 7, 7]);
});

test('teammates not in the config get no tools and no generation', async () => {
  const { service, kie } = setup({ users: ['slavik'] });
  const grant = service.grantFor('team-token')!;
  const list = (await service.handle(grant, rpc('tools/list'))) as { result: { tools: unknown[] } };
  assert.deepEqual(list.result.tools, []);
  const refused = await call(service, grant, 'kie_create_task', { body: { model: 'm', input: {} } });
  assert.equal(refused.isError, true);
  assert.equal(refused.text, TEAM_KIE_NOT_ALLOWED);
  assert.equal(kie.calls.length, 0);
  assert.equal(service.allowedUser(3), null);
  assert.equal(service.allowedUser(2), 'slavik');
});

test('no config file → nobody', () => {
  const { service } = setup(undefined);
  assert.equal(service.allowedUser(2), null);
  assert.equal(service.grantFor('bad'), null);
});

test('uploads only from the project folder', async () => {
  const { service, root, kie } = setup({ users: ['slavik'] });
  const grant = service.grantFor('run-token')!;
  fs.writeFileSync(path.join(root, 'ref.png'), 'png');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'team-kie-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.env'), 'KEY=1');
  fs.symlinkSync(path.join(outside, 'secret.env'), path.join(root, 'link.env'));

  const ok = await call(service, grant, 'kie_upload_file', { path: 'ref.png' });
  assert.equal(ok.isError, false);
  assert.equal(JSON.parse(ok.text).url, 'https://tempfile.example/up.png');

  for (const bad of ['../' + path.basename(outside) + '/secret.env', path.join(outside, 'secret.env'), 'link.env', 'missing.png']) {
    const refused = await call(service, grant, 'kie_upload_file', { path: bad });
    assert.equal(refused.isError, true, bad);
  }
  assert.equal(kie.calls.filter((entry) => entry.url.includes('file-stream-upload')).length, 1);
});

test('a Kie refusal is reported and nothing is charged', async () => {
  const { service, dir } = setup({ users: ['slavik'] }, fakeKie({ createCode: 402 }));
  const grant = service.grantFor('run-token')!;
  const refused = await call(service, grant, 'kie_create_task', { body: { model: 'm', input: {} } });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /402/);
  assert.equal(fs.existsSync(path.join(dir, 'ledger.json')), false);
  assert.equal((await call(service, grant, 'kie_create_task', { api: 'nope', body: {} })).isError, true);
});

test('a teammate Codex gets the kie server keyed by the run token env', async () => {
  const { prepareCodexHome } = await import('@/shared/user-jail.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'team-kie-home-'));
  const dir = prepareCodexHome({ root: '/work/proj', userId: 2 }, home, 'http://x/api/team-mcp/telegram', 'http://x/api/team-mcp/kie');
  const config = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
  assert.match(config, /\[mcp_servers\.kie\][^[]*url = "http:\/\/x\/api\/team-mcp\/kie"[^[]*bearer_token_env_var = "NEO3_TEAM_TELEGRAM_TOKEN"/);
  const without = fs.readFileSync(path.join(prepareCodexHome({ root: '/work/proj', userId: 2 }, home), 'config.toml'), 'utf8');
  assert.doesNotMatch(without, /mcp_servers\.kie/);
});
