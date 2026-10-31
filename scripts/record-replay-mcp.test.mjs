import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RecordReplayProxy, requestService, validateSocket } from './record-replay-mcp.mjs';

function harness() {
  const sent = [], forwarded = [], calls = [];
  const proxy = new RecordReplayProxy({
    send: message => sent.push(message),
    nativeWrite: message => forwarded.push(message),
    statusRequest: async (...args) => {
      calls.push(args);
      return { isRecording: false, maxDurationSeconds: 1800 };
    },
  });
  return { proxy, sent, forwarded, calls };
}

test('read-only status uses the verified socket and actual turn metadata', async () => {
  const h = harness();
  await h.proxy.receive({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {
    name: 'event_stream_status', arguments: {},
    _meta: { 'x-codex-turn-metadata': '{"thread_id":"test-thread","turn_id":"test-turn"}' },
  } });
  assert.deepEqual(JSON.parse(h.sent[0].result.content[0].text), { isRecording: false, maxDurationSeconds: 1800 });
  assert.equal(h.sent[0].id, 7);
  assert.deepEqual(h.calls, [['ComputerUseIPCEventStreamStatusRequest', {}, { thread_id: 'test-thread', turn_id: 'test-turn' }]]);
  assert.equal(h.forwarded.length, 0);
});

test('start and stop are delegated unchanged to the native MCP, never to the socket', async () => {
  const h = harness();
  for (const name of ['event_stream_start', 'event_stream_stop']) {
    const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {}, _meta: { preserved: true } } };
    await h.proxy.receive(message);
    assert.equal(h.forwarded.at(-1), message);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.sent.length, 0);
});

test('the native consent elicitation and the user answer pass through unchanged', async () => {
  const h = harness();
  const consent = { jsonrpc: '2.0', id: 'native-consent', method: 'elicitation/create', params: {
    message: 'Original native confirmation', requestedSchema: { type: 'object', properties: {} },
  } };
  h.proxy.receiveNative(consent);
  assert.equal(h.sent[0], consent);
  const denied = { jsonrpc: '2.0', id: 'native-consent', result: { action: 'decline' } };
  await h.proxy.receive(denied);
  assert.equal(h.forwarded[0], denied);
  assert.equal(h.calls.length, 0);
});

test('native initialization, tools, notifications, and errors retain original semantics', async () => {
  const h = harness();
  for (const message of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: { elicitation: { form: {} } } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]) {
    await h.proxy.receive(message);
    assert.equal(h.forwarded.at(-1), message);
  }
  const failure = { jsonrpc: '2.0', id: 3, result: { isError: true, content: [{ type: 'text', text: 'bootstrapTimedOut' }] } };
  h.proxy.receiveNative(failure);
  assert.equal(h.sent[0], failure);
});

test('unknown tools and unexpected status arguments are refused without socket access', async () => {
  const h = harness();
  await h.proxy.receive({ id: 1, method: 'tools/call', params: { name: 'delete_history' } });
  await h.proxy.receive({ id: 2, method: 'tools/call', params: { name: 'event_stream_status', arguments: { path: '/tmp' } } });
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent.every(x => x.result.isError));
  assert.equal(h.calls.length, 0);
  assert.equal(h.forwarded.length, 0);
});

test('status transport errors remain errors rather than an empty success', async () => {
  const h = harness();
  h.proxy.statusRequest = async () => { throw new Error('service unavailable'); };
  await h.proxy.receive({ id: 1, method: 'tools/call', params: { name: 'event_stream_status' } });
  assert.equal(h.sent[0].result.isError, true);
  assert.match(h.sent[0].result.content[0].text, /service unavailable/);
});

test('a failed native process preserves the request id in its error', async () => {
  const h = harness();
  h.proxy.nativeWrite = () => { throw new Error('native MCP unavailable'); };
  await h.proxy.receive({ id: 'start-request', method: 'tools/call', params: { name: 'event_stream_start' } });
  assert.equal(h.sent[0].id, 'start-request');
  assert.equal(h.sent[0].result.isError, true);
  assert.equal(h.calls.length, 0);
});

test('framed socket transport validates protocol and exact request types', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'record-replay-socket-test-'));
  const socketPath = path.join(dir, 'service.sock');
  const received = [];
  const service = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (buffer.length < size + 4) return;
        const request = JSON.parse(buffer.subarray(4, size + 4));
        buffer = buffer.subarray(size + 4);
        received.push(request);
        const response = { id: request.id, jsonrpc: '2.0', result: request.method === 'ping'
          ? { serverApiVersion: 'CodexComputerUseIPC-5' } : { isRecording: false } };
        const payload = Buffer.from(JSON.stringify(response));
        const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
        socket.write(header); socket.write(payload);
      }
    });
  });
  await new Promise(resolve => service.listen(socketPath, resolve));
  await fs.chmod(socketPath, 0o600);
  t.after(async () => {
    await new Promise(resolve => service.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const r = await requestService('ComputerUseIPCEventStreamStatusRequest', {}, undefined, { socketPath });
  assert.deepEqual(r, { isRecording: false });
  assert.equal(received[1].params.requestType, 'ComputerUseIPCEventStreamStatusRequest');
  await assert.rejects(requestService('ComputerUseIPCSkysightClearHistoryRequest', {}, undefined, { socketPath }), /Unsupported/);
  await fs.chmod(socketPath, 0o666);
  await assert.rejects(validateSocket(socketPath), /private CUA service socket/);
});

test('regular files and symlink sockets are not accepted as a service endpoint', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'record-replay-path-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'fake'), 'not a service');
  await fs.symlink(path.join(dir, 'fake'), path.join(dir, 'symlink'));
  await assert.rejects(validateSocket(path.join(dir, 'fake')), /private CUA service socket/);
  await assert.rejects(validateSocket(path.join(dir, 'symlink')), /private CUA service socket/);
});
