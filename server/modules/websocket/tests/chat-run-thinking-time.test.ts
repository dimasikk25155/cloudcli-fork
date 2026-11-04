import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closeConnection, initializeDatabase, runDurationsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * «Думал N с · ответ за N с»: the registry measures thinking for every engine
 * from the events it forwards — the interval «previous event → thinking
 * event», consecutive thinking events extend it, the sum per turn.
 *
 * Fixtures (relative ms → normalized event as the engine adapter emits it):
 * - run-timing-claude.jsonl — clocks of a real Claude Code session
 *   (~/.claude/projects, one turn): thinking blocks arrive with an empty text
 *   (only a signature), each as its own assistant line; texts replaced.
 * - run-timing-codex.jsonl — clocks of a real Codex SDK rollout
 *   (~/.codex/sessions, 04.11): reasoning items have only `item.completed`,
 *   commands come as started+completed tool_use rows; texts replaced.
 * - run-timing-grok.jsonl — Grok history has no clocks, so the timeline is
 *   built by hand: thinking streamed in two chunks, a helper (crab) whose own
 *   thinking must not count.
 * Expected sums are worked out by hand from the `at` columns.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

class FakeConnection {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];
  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(run: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-run-thinking-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

type TimedEvent = { at: number; event: Record<string, unknown> };

async function loadTimeline(name: string): Promise<TimedEvent[]> {
  const text = await readFile(path.join(FIXTURES, name), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line) as TimedEvent);
}

function replay(sessionId: string, provider: LLMProvider, timeline: TimedEvent[]) {
  sessionsDb.createAppSession(sessionId, provider, '/workspace/demo');
  const connection = new FakeConnection();
  let clock = 0;
  const run = chatRunRegistry.startRun({ appSessionId: sessionId, provider, providerSessionId: null,
    connection, userId: null, now: () => clock });
  assert.ok(run);
  for (const { at, event } of timeline) {
    clock = at;
    run.writer.send(event as never);
  }
  const complete = connection.frames.find((frame) => frame.kind === 'complete');
  return { complete, rows: runDurationsDb.list(sessionId) };
}

for (const [provider, fixture, thinkingMs, durationMs] of [
  ['claude', 'run-timing-claude.jsonl', 26_340 + 3_810 + 2_420 + 3_350, 47_400],
  ['codex', 'run-timing-codex.jsonl', 14_300 + 10_200 + 4_700 + 4_400, 106_000],
  ['grok', 'run-timing-grok.jsonl', 4_000 + 500 + 3_000, 12_400],
] as const) {
  test(`${provider}: thinking time is summed per turn, sent in complete and saved`, async () => {
    await withIsolatedDatabase(async () => {
      const { complete, rows } = replay(`thinking-${provider}`, provider, await loadTimeline(fixture));
      assert.equal(complete?.thinkingDurationMs, thinkingMs);
      assert.equal(complete?.completionDurationMs, durationMs);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].thinking_ms, thinkingMs);
      assert.equal(rows[0].duration_ms, durationMs);
    });
  });
}

test('a turn without thinking has only the answer time; an aborted turn writes nothing', async () => {
  await withIsolatedDatabase(async () => {
    const plain = replay('thinking-none', 'codex', [
      { at: 800, event: { kind: 'text', role: 'assistant', content: 'Привет!' } },
      { at: 900, event: { kind: 'complete', exitCode: 0 } },
    ]);
    assert.equal(plain.complete?.completionDurationMs, 900);
    assert.equal('thinkingDurationMs' in (plain.complete ?? {}), false);
    assert.equal(plain.rows[0].thinking_ms, null);

    const timeline = await loadTimeline('run-timing-claude.jsonl');
    const aborted = replay('thinking-aborted', 'claude', timeline.map((line) => line.event.kind === 'complete'
      ? { ...line, event: { ...line.event, aborted: true } } : line));
    assert.equal(aborted.rows.length, 0);
    assert.equal('thinkingDurationMs' in (aborted.complete ?? {}), false);
  });
});
