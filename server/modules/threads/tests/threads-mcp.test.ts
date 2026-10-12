import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The stdio MCP server every engine (Claude, Codex, Grok) loads: it lists the
// four thread tools and forwards each call to Neo3 over HTTP with the run's
// thread token. Here Neo3 is a stand-in HTTP server.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const tsxBin = path.join(root, 'node_modules', '.bin', 'tsx');
const mcpScript = path.join(root, 'server', 'threads-mcp.ts');

type Recorded = { url: string; authorization: string | undefined; body: unknown };

async function withFakeNeo3(
  reply: (request: Recorded) => { status: number; body: unknown },
  runTest: (apiUrl: string, recorded: Recorded[]) => Promise<void>,
): Promise<void> {
  const recorded: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const entry = { url: req.url ?? '', authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : null };
      recorded.push(entry);
      const { status, body } = reply(entry);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await runTest(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/threads`, recorded);
  } finally {
    server.close();
  }
}

class McpClient {
  private buffer = '';
  private nextId = 1;
  private readonly waiting = new Map<number, (message: Record<string, unknown>) => void>();
  readonly child: ChildProcessWithoutNullStreams;

  constructor(env: Record<string, string | undefined>) {
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (value !== undefined) childEnv[key] = value;
    }
    this.child = spawn(tsxBin, ['--tsconfig', path.join(root, 'server', 'tsconfig.json'), mcpScript], { env: childEnv, cwd: root });
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let index: number;
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        const resolve = this.waiting.get(message.id as number);
        if (resolve) {
          this.waiting.delete(message.id as number);
          resolve(message);
        }
      }
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode === null) {
      this.child.kill('SIGTERM');
      await once(this.child, 'exit');
    }
  }
}

async function withClient(env: Record<string, string | undefined>, runTest: (client: McpClient) => Promise<void>) {
  const client = new McpClient(env);
  try {
    await runTest(client);
  } finally {
    await client.close();
  }
}

function textOf(result: Record<string, unknown>): string {
  const content = (result.content as Array<{ type: string; text: string }>) ?? [];
  return content.map((block) => block.text).join('\n');
}

test('initialize and tools/list expose exactly the four thread tools with their inputs', async () => {
  await withClient({ NEO3_THREADS_TOKEN: 'a'.repeat(64), NEO3_THREADS_API_URL: 'http://127.0.0.1:9/api/threads' }, async (client) => {
    const init = await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assert.ok((init.result as { capabilities: { tools?: unknown } }).capabilities.tools);

    const list = await client.request('tools/list');
    const tools = (list.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }> }).tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.deepEqual([...byName.keys()].sort(), ['message_thread', 'spawn_thread', 'stop_thread', 'thread_status']);
    assert.deepEqual(Object.keys(byName.get('spawn_thread')!.inputSchema.properties).sort(), ['model', 'prompt', 'provider', 'title']);
    assert.deepEqual(byName.get('spawn_thread')!.inputSchema.required, ['prompt']);
    assert.deepEqual(Object.keys(byName.get('thread_status')!.inputSchema.properties).sort(), ['threadId', 'wait']);
    assert.deepEqual(byName.get('message_thread')!.inputSchema.required?.sort(), ['text', 'threadId']);
    assert.deepEqual(byName.get('stop_thread')!.inputSchema.required, ['threadId']);
  });
});

test('a tool call goes to Neo3 with the run token and returns Neo3\'s answer', async () => {
  const token = 'b'.repeat(64);
  await withFakeNeo3(() => ({ status: 200, body: { success: true, data: { threadId: 't-42', state: 'working' } } }), async (apiUrl, recorded) => {
    await withClient({ NEO3_THREADS_TOKEN: token, NEO3_THREADS_API_URL: apiUrl }, async (client) => {
      const answer = await client.request('tools/call', {
        name: 'spawn_thread',
        arguments: { prompt: 'Проверь тесты', provider: 'grok' },
      });
      const result = answer.result as Record<string, unknown>;
      assert.notEqual(result.isError, true);
      assert.match(textOf(result), /t-42/);
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].url, '/api/threads/tools/spawn_thread');
      assert.equal(recorded[0].authorization, `Bearer ${token}`);
      assert.deepEqual(recorded[0].body, { prompt: 'Проверь тесты', provider: 'grok' });
    });
  });
});

test('a refusal from Neo3 becomes a tool error with its text, not a crash', async () => {
  await withFakeNeo3(() => ({ status: 409, body: { success: false, code: 'THREAD_BUSY', error: 'Тред занят — дождись конца его хода' } }), async (apiUrl) => {
    await withClient({ NEO3_THREADS_TOKEN: 'c'.repeat(64), NEO3_THREADS_API_URL: apiUrl }, async (client) => {
      const answer = await client.request('tools/call', { name: 'message_thread', arguments: { threadId: 't-1', text: 'ещё' } });
      const result = answer.result as Record<string, unknown>;
      assert.equal(result.isError, true);
      assert.match(textOf(result), /Тред занят/);

      const again = await client.request('tools/call', { name: 'thread_status', arguments: {} });
      assert.ok(again.result, 'the server keeps serving after a refusal');
    });
  });
});

test('without a token in the engine environment the tools refuse honestly and call nothing', async () => {
  await withFakeNeo3(() => ({ status: 200, body: { success: true, data: {} } }), async (apiUrl, recorded) => {
    await withClient({ NEO3_THREADS_TOKEN: undefined, NEO3_THREADS_API_URL: apiUrl }, async (client) => {
      const answer = await client.request('tools/call', { name: 'spawn_thread', arguments: { prompt: 'x' } });
      const result = answer.result as Record<string, unknown>;
      assert.equal(result.isError, true);
      assert.match(textOf(result), /тред недоступен в этом движке/i);
      assert.equal(recorded.length, 0);
    });
  });
});

test('an unknown tool is a tool error', async () => {
  await withClient({ NEO3_THREADS_TOKEN: 'd'.repeat(64), NEO3_THREADS_API_URL: 'http://127.0.0.1:9/api/threads' }, async (client) => {
    const answer = await client.request('tools/call', { name: 'rm_rf', arguments: {} });
    const failed = (answer.result as Record<string, unknown> | undefined)?.isError === true || Boolean(answer.error);
    assert.ok(failed);
  });
});
