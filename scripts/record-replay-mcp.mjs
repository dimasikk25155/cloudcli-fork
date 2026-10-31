#!/usr/bin/env node
// Record & Replay adapter for the shipped CUA JSON-RPC socket transport.
// The native MCP executable currently times out during its XPC bootstrap.
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const API_VERSION = 'CodexComputerUseIPC-5';
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const REQUEST_TYPES = new Set([
  'ComputerUseIPCEventStreamStatusRequest',
]);
export function defaultSocketPath() {
  return path.join(os.homedir(), 'Library', 'Group Containers',
    '2DC432GLL2.com.openai.sky.CUAService', 'IPC', 'computeruse.sock');
}

export async function validateSocket(socketPath, expectedUid = process.getuid?.()) {
  const [socket, parent] = await Promise.all([
    fs.lstat(socketPath), fs.lstat(path.dirname(socketPath)),
  ]);
  if (!socket.isSocket() || socket.uid !== expectedUid || parent.uid !== expectedUid
      || !parent.isDirectory() || (socket.mode & 0o077) || (parent.mode & 0o077)) {
    throw new Error('Record & Replay requires the current user\'s private CUA service socket.');
  }
}

/** Same framed ping/request protocol as the shipped @oai/sky native-pipe.js. */
export async function requestService(requestType, request = {}, metadata, options = {}) {
  if (!REQUEST_TYPES.has(requestType)) throw new Error('Unsupported Record & Replay request type.');
  const socketPath = options.socketPath ?? defaultSocketPath();
  const timeoutMs = options.timeoutMs ?? 10_000;
  await validateSocket(socketPath);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Record & Replay service request timed out.')), timeoutMs);
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const send = (id, method, params) => {
      const bytes = Buffer.from(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
      if (bytes.length > MAX_FRAME_BYTES) throw new Error('Record & Replay request is too large.');
      const frame = Buffer.alloc(4 + bytes.length);
      frame.writeUInt32LE(bytes.length, 0);
      bytes.copy(frame, 4);
      socket.write(frame);
    };
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(new Error('Record & Replay service closed before responding.')));
    socket.on('connect', () => send(1, 'ping', { clientApiVersion: API_VERSION }));
    socket.on('data', chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
          const size = buffer.readUInt32LE(0);
          if (size > MAX_FRAME_BYTES) throw new Error('Record & Replay service frame is too large.');
          if (buffer.length < size + 4) break;
          const message = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'));
          buffer = buffer.subarray(size + 4);
          if (message.jsonrpc !== '2.0' || ![1, 2].includes(message.id)) continue;
          if (message.error) throw new Error(message.error.message || 'Record & Replay service rejected the request.');
          if (message.id === 1) {
            if (message.result?.serverApiVersion !== API_VERSION) {
              throw new Error('Record & Replay service protocol version mismatch; update the adapter and service together.');
            }
            // Match the shipped client's awaited ping before the next request.
            queueMicrotask(() => send(2, 'request', {
              clientApiVersion: API_VERSION,
              deadlineUnixMilliseconds: Date.now() + timeoutMs,
              requestType,
              request,
              ...(metadata ? { codexTurnMetadata: metadata } : {}),
            }));
          } else {
            finish(null, message.result);
          }
        }
      } catch (error) { finish(error); }
    });
  });
}

const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function turnMetadata(params) {
  const value = params?._meta?.['x-codex-turn-metadata'];
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return parsed; } catch { /* No invented metadata. */ }
  }
  return undefined;
}

/**
 * Only the read-only status call uses the verified socket protocol. Everything
 * else is relayed to the unmodified native MCP, including its exact consent
 * elicitation and the client's answers. The adapter cannot start or stop a
 * recording through the socket and does not claim to repair native XPC calls.
 */
export class RecordReplayProxy {
  constructor({ send, nativeWrite, statusRequest = requestService }) {
    this.send = send;
    this.nativeWrite = nativeWrite;
    this.statusRequest = statusRequest;
  }

  async receive(message) {
    if (message.method !== 'tools/call') {
      this.forward(message);
      return;
    }
    if (message.params?.name !== 'event_stream_status') {
      if (!['event_stream_start', 'event_stream_stop'].includes(message.params?.name)) {
        this.error(message.id, 'Unknown Record & Replay tool.');
        return;
      }
      this.forward(message);
      return;
    }
    const params = message.params;
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args) || Object.keys(args).length) {
      this.error(message.id, 'event_stream_status does not accept arguments.');
      return;
    }
    try {
      const result = await this.statusRequest('ComputerUseIPCEventStreamStatusRequest', {}, turnMetadata(params));
      this.send({ jsonrpc: '2.0', id: message.id, result: toolResult(result) });
    } catch (error) {
      this.error(message.id, error instanceof Error ? error.message : 'Record & Replay status failed.');
    }
  }

  receiveNative(message) {
    this.send(message);
  }

  forward(message) {
    try { this.nativeWrite(message); } catch (error) {
      const text = error instanceof Error ? error.message : 'The native Record & Replay MCP is unavailable.';
      if (message.method === 'tools/call') this.error(message.id, text);
      else if (message.id !== undefined && message.method !== undefined) {
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: text } });
      }
    }
  }

  error(id, text) {
    this.send({ jsonrpc: '2.0', id, result: {
      content: [{ type: 'text', text }], isError: true,
    } });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const client = path.join(codexHome, 'computer-use', 'Codex Computer Use.app',
    'Contents', 'SharedSupport', 'SkyComputerUseClient.app', 'Contents', 'MacOS', 'SkyComputerUseClient');
  const env = {};
  for (const key of ['HOME', 'USERPROFILE', 'PATH', 'CODEX_HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawn(client, ['event-stream', 'mcp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  const proxy = new RecordReplayProxy({ send, nativeWrite: message => {
    if (!child.stdin.writable) throw new Error('The native Record & Replay MCP is unavailable.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  } });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  input.on('line', line => {
    try {
      void proxy.receive(JSON.parse(line)).catch(error => {
        send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message } });
      });
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } });
    }
  });
  output.on('line', line => {
    try { proxy.receiveNative(JSON.parse(line)); } catch { /* Native non-protocol stdout is not an MCP response. */ }
  });
  child.stderr.pipe(process.stderr);
  input.on('close', () => child.stdin.end());
  child.on('error', error => {
    process.stderr.write(`Record & Replay native client failed: ${error.message}\n`);
    process.exitCode = 1;
    input.close();
  });
  child.on('exit', code => {
    process.exitCode = code ?? 1;
    input.close();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { child.kill(signal); input.close(); });
  }
}
