import assert from 'node:assert/strict';
import test from 'node:test';

import { createTeamTelegram, TEAM_TELEGRAM_DENIED, type TelegramUpstream } from '@/modules/team-telegram/index.js';

function fakeUpstream() {
  const roots: string[] = [];
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const connect = async (root: string): Promise<TelegramUpstream> => {
    roots.push(root);
    return {
      listTools: async () => ({ tools: [{ name: 'get_messages' }, { name: 'send_message' }, { name: 'download_media' }, { name: 'delete_message' }] }),
      callTool: async (params) => {
        calls.push(params);
        return { content: [{ type: 'text', text: `ok ${params.name}` }] };
      },
    };
  };
  return { roots, calls, connect };
}

const rpc = (method: string, params: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 1, method, params });

test('teammates read Telegram and download into their project — nothing else', async () => {
  const upstream = fakeUpstream();
  const service = createTeamTelegram({ connect: upstream.connect });
  const token = service.issue({ root: '/work/difinance', userId: 2 });
  const grant = service.grantFor(token)!;
  assert.equal(grant.root, '/work/difinance');

  const list = (await service.handle(grant, rpc('tools/list'))) as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['get_messages', 'download_media']);

  const send = (await service.handle(grant, rpc('tools/call', { name: 'send_message', arguments: { message: 'x' } }))) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(send.result.isError, true);
  assert.equal(send.result.content[0].text, TEAM_TELEGRAM_DENIED);

  await service.handle(grant, rpc('tools/call', { name: 'download_media', arguments: { chat_id: 1, message_id: 2 } }));
  assert.deepEqual(upstream.calls, [{ name: 'download_media', arguments: { chat_id: 1, message_id: 2 } }]);
  // The upstream session declares the project folder as its only root.
  assert.deepEqual(upstream.roots, ['/work/difinance']);

  // Notifications get no reply; unknown methods a JSON-RPC error.
  assert.equal(await service.handle(grant, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(((await service.handle(grant, rpc('resources/list'))) as { error: { code: number } }).error.code, -32601);
});

test('a wrong or expired key opens nothing', () => {
  let time = 1_000;
  const service = createTeamTelegram({ connect: fakeUpstream().connect, now: () => time });
  const token = service.issue({ root: '/work/p', userId: 3 });
  assert.equal(service.grantFor('not-a-token'), null);
  assert.equal(service.grantFor(null), null);
  assert.ok(service.grantFor(token));
  time += 25 * 60 * 60 * 1000;
  assert.equal(service.grantFor(token), null);
});
