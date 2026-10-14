import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { isGrokChildSession } from '@/modules/providers/list/grok/grok-session-synchronizer.provider.js';
import { GrokSessionsProvider } from '@/modules/providers/list/grok/grok-sessions.provider.js';
import { parseGrokSubagentReturns, readGrokSubagentId } from '@/modules/providers/list/grok/grok-subagents.js';
import type { NormalizedMessage } from '@/shared/types.js';

/**
 * Fixtures are built from Grok 1.0.52's own documentation and strings (the
 * `streaming-messages-json` shape, `spawn_subagent` tool definition and the
 * «Subagent '<description>' (<id>) completed successfully. N tool calls,
 * M turns.» return text). No live helper run existed yet when they were
 * written; replace them with a captured run once Grok has quota again.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const A = '019a1b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b';
const B = '019a1b2c-3d4e-7f00-9b2c-3d4e5f6a7b8c';
const CMD = '019a1b2c-3d4e-7f00-ac3d-4e5f6a7b8c9d';
const SESSION = 'grok-subagent-session';

async function loadLines(name: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path.join(FIXTURES, name), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

function liveRows(lines: Record<string, unknown>[]): NormalizedMessage[] {
  const provider = new GrokSessionsProvider();
  return lines.flatMap((line) => provider.normalizeMessage(line, SESSION));
}

test('live: helper tools reach the chat only nested under their spawn call', async () => {
  const rows = liveRows(await loadLines('grok-subagent-live.jsonl'));
  const children = rows.filter((row) => row.parentToolUseId);
  assert.deepEqual(
    children.map((row) => [row.kind, row.toolId, row.parentToolUseId]),
    [
      ['tool_use', 'call-child-1', 'call-spawn-1'],
      ['tool_result', 'call-child-1', 'call-spawn-1'],
      // parent_tool_use_id carrying the helper id resolves to its spawn call
      ['tool_use', 'call-child-2', 'call-spawn-2'],
    ],
  );
  const texts = rows.filter((row) => row.kind === 'text' || row.kind === 'thinking').map((row) => row.content);
  assert.deepEqual(texts, ['Запускаю двух помощников.']);
});

test('live: returns close the right crab with effort; a background command never does', async () => {
  const rows = liveRows(await loadLines('grok-subagent-live.jsonl'));
  const returns = rows.filter((row) => row.kind === 'task_notification');
  assert.deepEqual(
    returns.map((row) => [row.toolId, row.status, row.usage]),
    [
      ['call-spawn-1', 'completed', { toolUses: 7, durationMs: 64_000 }],
      ['call-spawn-2', 'cancelled', { toolUses: 2 }],
    ],
  );
  assert.equal(returns.some((row) => row.toolId === 'call-bg-cmd'), false);
  // The return turn is not a human bubble.
  assert.equal(rows.some((row) => row.kind === 'text' && row.role === 'user'), false);
});

test('live: a background spawn that failed to start ends its crab at once', () => {
  const provider = new GrokSessionsProvider();
  provider.normalizeMessage({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call-x', name: 'spawn_subagent', input: { prompt: 'p', description: 'd' } }] },
  }, SESSION);
  const rows = provider.normalizeMessage({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-x', content: 'Subagents are disabled', is_error: true }] },
  }, SESSION);
  assert.deepEqual(rows.map((row) => [row.kind, row.toolId, row.status]), [
    ['tool_result', 'call-x', undefined],
    ['task_notification', 'call-x', 'failed'],
  ]);
});

test('history: background return becomes a notification, blocking helper ends with its result', async (t) => {
  const lines = await loadLines('grok-subagent-history.jsonl');
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'grok-subagent-history-'));
  t.after(async () => {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const sessionDir = path.join(tempDirectory, 'sessions', 'fixture', SESSION);
  await mkdir(sessionDir, { recursive: true });
  const historyPath = path.join(sessionDir, 'chat_history.jsonl');
  await writeFile(historyPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const sessionId = sessionsDb.createSession(SESSION, 'grok', '/tmp/fixture', undefined, undefined, undefined, historyPath);

  const history = await new GrokSessionsProvider().fetchHistory(sessionId);
  const spawns = history.messages.filter((row) => row.toolName === 'spawn_subagent');
  assert.equal(spawns.length, 2);
  assert.match(String(spawns[1].toolResult?.content), /3 \.md files/);

  const returns = history.messages.filter((row) => row.kind === 'task_notification');
  assert.deepEqual(returns.map((row) => [row.toolId, row.status, row.usage]), [
    ['call-spawn-1', 'completed', { toolUses: 5, durationMs: 28_000 }],
  ]);
  const userBubbles = history.messages.filter((row) => row.kind === 'text' && row.role === 'user');
  assert.deepEqual(userBubbles.map((row) => row.content), ['Посчитай файлы двумя помощниками']);
});

test('return parser: only known ids, only real endings', () => {
  const text = [
    `Command ${CMD} completed with exit code 0.`,
    '',
    `Subagent 'a' (${A}) hit max-turns limit (50). 50 tool calls, 50 turns.`,
    '',
    `Subagent 'running tests' (${B}) is still running.`,
  ].join('\n');
  assert.deepEqual(parseGrokSubagentReturns(text, [A, B]), [
    { subagentId: A, status: 'failed', toolUses: 50, durationMs: undefined },
  ]);
  assert.deepEqual(parseGrokSubagentReturns(text, []), []);
});

test('spawn result id: keyed form wins over other uuids', () => {
  assert.equal(readGrokSubagentId(`worktree ${CMD}\n{"subagent_id":"${A.toUpperCase()}"}`), A);
  assert.equal(readGrokSubagentId(`started ${B}`), B);
  assert.equal(readGrokSubagentId('no id here'), null);
});

test('a helper child session never claims the chat that started it', () => {
  assert.equal(isGrokChildSession({ info: { id: 'x', cwd: '/tmp' }, session_kind: 'headless' }), false);
  assert.equal(isGrokChildSession({ parent_session_id: 'p' }), true);
  assert.equal(isGrokChildSession({ info: { parentSessionId: 'p' } }), true);
  assert.equal(isGrokChildSession({ session_kind: 'subagent' }), true);
});
