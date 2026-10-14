#!/usr/bin/env node
/**
 * Neo3 threads — stdio MCP server loaded by every engine (Claude, Codex, Grok).
 *
 * It holds no state and no rights of its own: each tool call is forwarded to
 * the Neo3 server that started the engine (`NEO3_THREADS_API_URL`) with the
 * thread token of that run (`NEO3_THREADS_TOKEN`). Both variables come from
 * the engine process environment — Neo3 puts them there per run; the global
 * registration (~/.claude.json, ~/.codex/config.toml) carries no secret.
 * No token → every tool answers «тред недоступен в этом движке»;
 * `NEO3_THREADS_OFF=1` (the user switched threads off) → spawn/message refused
 * with the registry's «мод выключен» text; status/stop still go through when
 * the run has a token (the chat already has threads).
 */

import { modOffMessage } from '../shared/mods.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const MAX_WAIT_SEC = 600;
const HTTP_MARGIN_MS = 60_000;

const textResult = (text: string, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

const apiUrl = (process.env.NEO3_THREADS_API_URL
  || `http://127.0.0.1:${process.env.SERVER_PORT || '3001'}/api/threads`).replace(/\/$/, '');
const apiToken = (process.env.NEO3_THREADS_TOKEN || '').trim();
/** The user switched «Треды» off in Neo3: the run has no token on purpose. */
const threadsOff = (process.env.NEO3_THREADS_OFF || '').trim() === '1';

const tools: ToolDefinition[] = [
  {
    name: 'spawn_thread',
    description: [
      'Open a new Neo3 chat (a "thread") in the same project and start it on a task. The thread is a real chat:',
      'the user sees it in the sidebar, can open it and write to it. Use threads for parallel or routine work;',
      'by default a thread runs on Grok grok-4.7-build-fast (does not spend the Claude limit).',
      'provider: "grok" (default) | "claude" | "codex" | "local" (free local model on the Claude engine).',
      'Models: grok-4.7, grok-4.7-build-fast; claude opus[1m], sonnet[1m], fable, local-qwen35-9b, local-ornith-9b;',
      'codex — catalog models of the astra/sol families. At most 3 threads work at once; a thread cannot open threads.',
      'The prompt must be self-contained: the thread does not see this conversation.',
      'Returns threadId. When the user is idle and all threads are done, Neo3 sends you one «Треды готовы» message.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Complete task for the thread (it does not see this chat).' },
        title: { type: 'string', description: 'Short chat name shown in the sidebar.' },
        provider: { type: 'string', enum: ['grok', 'claude', 'codex', 'local'], description: 'Engine; default grok.' },
        model: { type: 'string', description: 'Model id of that engine; default per engine.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'thread_status',
    description: [
      'State of your threads (or one thread): working / waiting (asks a question) / done / failed, with the last reply.',
      `wait: seconds (≤ ${MAX_WAIT_SEC}) to wait until the threads stop working before answering.`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'One thread; omit for all threads of this chat.' },
        wait: { type: 'number', description: `Seconds to wait for completion, 0–${MAX_WAIT_SEC}.` },
      },
    },
  },
  {
    name: 'message_thread',
    description: 'Send a follow-up message to an idle thread (refused while it is working: "тред занят").',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        text: { type: 'string', description: 'Message for the thread.' },
      },
      required: ['threadId', 'text'],
    },
  },
  {
    name: 'stop_thread',
    description: 'Stop the current run of a thread (same as the user pressing Stop in it).',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
      },
      required: ['threadId'],
    },
  },
];

const TOOL_NAMES = new Set(tools.map((tool) => tool.name));
/** Tools that start new thread work — refused while «Треды» is switched off. */
const NEW_WORK_TOOLS = new Set(['spawn_thread', 'message_thread']);

function pickArguments(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(((tools.find((tool) => tool.name === name)?.inputSchema.properties) ?? {}) as Record<string, unknown>);
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (args[key] !== undefined) picked[key] = args[key];
  }
  return picked;
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (!TOOL_NAMES.has(name)) {
    return textResult(`Unknown tool: ${name}`, true);
  }
  // «Треды» switched off: nothing new — no new thread, no message to one.
  // Following and stopping threads the chat already has stays possible (the
  // run then still has a token).
  if (threadsOff && (NEW_WORK_TOOLS.has(name) || !apiToken)) {
    return textResult(
      NEW_WORK_TOOLS.has(name)
        ? `${modOffMessage('modThreads')}. Новый тред открыть или написать в тред нельзя — сделай работу сам в этом чате.`
        : `${modOffMessage('modThreads')}. У этого чата нет запущенных тредов.`,
      true,
    );
  }
  if (!apiToken) {
    return textResult(
      'Тред недоступен в этом движке: Neo3 не передал токен тредов (NEO3_THREADS_TOKEN) в окружение этого прогона. '
      + 'Треды работают только в чатах Neo3.',
      true,
    );
  }

  const input = pickArguments(name, args);
  const waitSec = name === 'thread_status' && typeof input.wait === 'number' ? Math.min(Math.max(input.wait, 0), MAX_WAIT_SEC) : 0;
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(waitSec * 1000 + HTTP_MARGIN_MS),
    });
  } catch (error) {
    return textResult(`Neo3 не ответил (${error instanceof Error ? error.message : String(error)}).`, true);
  }

  let payload: { success?: boolean; data?: unknown; error?: string } = {};
  try {
    payload = await response.json() as typeof payload;
  } catch {
    payload = {};
  }
  if (!response.ok || payload.success === false) {
    return textResult(payload.error || `Neo3 отказал (${response.status}).`, true);
  }
  return textResult(JSON.stringify(payload.data ?? null, null, 2));
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'neo3-threads', version: '1.0.0' },
    };
  }
  if (message.method === 'ping') {
    return {};
  }
  if (message.method === 'tools/list') {
    return { tools };
  }
  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
    return callTool(name, args);
  }
  if (message.method.startsWith('notifications/')) {
    return undefined;
  }
  throw new Error(`Unsupported method: ${message.method}`);
}

// MCP stdio transport: newline-delimited JSON-RPC, one message per line.
function writeMessage(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const rawMessage = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!rawMessage) continue;

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch (error) {
        writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
        return;
      }
      try {
        const result = await handleMessage(request);
        if (request.id !== undefined) writeMessage({ jsonrpc: '2.0', id: request.id, result });
      } catch (error) {
        if (request.id !== undefined) {
          writeMessage({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: error instanceof Error ? error.message : String(error) } });
        }
      }
    })();
  }
});
process.stdin.on('end', () => process.exit(0));
