import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import { getSessionLinks } from '@/modules/session-links/index.js';
import { createThreadsService, createThreadTokens, ThreadsError } from '@/modules/threads/index.js';
import type { ThreadRunStart } from '@/modules/threads/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import type { RunPhase } from '../../../../shared/run-phase.js';

// Stories 23–30, 26a: spawn_thread / thread_status / message_thread /
// stop_thread act for the parent chat's user, in the parent's project, with
// the limits of R25i and the Claude 5-hour guard; one «Треды готовы» message
// when the parent is idle and its threads are settled.

type Attention = { state: string; reason?: string | null; detail?: Record<string, unknown> | null };

type World = {
  service: ReturnType<typeof createThreadsService>;
  tokens: ReturnType<typeof createThreadTokens>;
  starts: ThreadRunStart[];
  aborts: string[];
  running: Set<string>;
  /** Phase of a chat's live run when it is not simply «in a turn» (a held Claude run between turns). */
  phases: Map<string, RunPhase>;
  attention: Map<string, Attention>;
  replies: Map<string, string>;
  limit: { blocked: boolean };
  limitChecks: number[];
  clockMs: { value: number };
  admin: number;
  member: number;
  projectA: string;
  projectAId: string;
  parentId: string;
  parentToken: string;
  /** Mods switched off for everyone in this world (flip mid-test to switch). */
  modsOff: Set<string>;
};

async function withWorld(
  runTest: (world: World) => void | Promise<void>,
  overrides: { listModels?: (provider: string) => Promise<string[]> } = {},
): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'threads-service-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const admin = Number(userDb.createUserWithRole('owner', 'unused', 'admin').id);
    const member = Number(userDb.createUserWithRole('member', 'unused', 'user').id);
    const projectA = projectsDb.createProjectPath(path.join(directory, 'project-a')).project!;
    projectsDb.createProjectPath(path.join(directory, 'project-foreign'));
    userProjectAccessDb.grantAccess(member, projectA.project_id, admin);

    const clockMs = { value: new Date('2026-10-12T10:00:00.000Z').getTime() };
    const now = () => new Date(clockMs.value);
    const starts: ThreadRunStart[] = [];
    const aborts: string[] = [];
    const running = new Set<string>();
    const phases = new Map<string, RunPhase>();
    const phaseOf = (sessionId: string): RunPhase | null => (running.has(sessionId) ? phases.get(sessionId) ?? 'running' : null);
    const attention = new Map<string, Attention>();
    const replies = new Map<string, string>();
    const limit = { blocked: false };
    const limitChecks: number[] = [];
    const tokens = createThreadTokens({ now });
    const modsOff = new Set<string>();

    const service = createThreadsService({
      tokens,
      now,
      isProcessing: (sessionId) => running.has(sessionId),
      runPhase: phaseOf,
      attentionOf: (sessionId) => attention.get(sessionId) ?? null,
      fetchMessages: async (sessionId) => {
        const reply = replies.get(sessionId);
        return reply
          ? [{ kind: 'text', role: 'user', content: 'задача' }, { kind: 'text', role: 'assistant', content: reply }]
          : [];
      },
      checkClaudeLimit: async () => {
        limitChecks.push(clockMs.value);
        return limit.blocked ? { blocked: true, notice: 'Использовано 95% 5-часового лимита' } : { blocked: false };
      },
      listModels: overrides.listModels ?? (async (provider) => (provider === 'codex' ? ['gpt-6-sol', 'gpt-6-astra', 'gpt-5-mini'] : [])),
      sleep: async (ms) => { clockMs.value += ms; },
      broadcastUpsert: () => {},
      pollMs: 2000,
      isModOn: (_userId, key) => !modsOff.has(key),
    });
    service.setRunControl({
      start: (input) => {
        // Like the gateway: a turn that is going refuses, a held process between turns takes the message.
        if (phaseOf(input.sessionId) === 'running') return false;
        starts.push(input);
        running.add(input.sessionId);
        phases.delete(input.sessionId);
        return true;
      },
      abort: async (sessionId) => {
        aborts.push(sessionId);
        running.delete(sessionId);
        phases.delete(sessionId);
        return true;
      },
    });

    const parentId = 'parent-chat';
    sessionsDb.createAppSession(parentId, 'claude', projectA.project_path);
    sessionsDb.updateSessionCustomName(parentId, 'Большая задача');
    const parentToken = tokens.issue({ sessionId: parentId, userId: member, permissionMode: 'acceptEdits' })!;

    await runTest({
      service, tokens, starts, aborts, running, phases, attention, replies, limit, limitChecks, clockMs,
      admin, member, projectA: projectA.project_path, projectAId: projectA.project_id, parentId, parentToken, modsOff,
    });
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function refused(promise: Promise<unknown>, code: string): Promise<ThreadsError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ThreadsError, `expected ThreadsError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.ok(error.message.length > 0);
    return error;
  }
  assert.fail(`expected refusal ${code}`);
}

/** A thread run ends: no longer running, status from «Ждут тебя», a last reply. */
function finish(world: World, threadId: string, attention: Attention, reply?: string): void {
  world.running.delete(threadId);
  world.attention.set(threadId, attention);
  if (reply) world.replies.set(threadId, reply);
}

// --- spawn_thread -----------------------------------------------------------

test('spawn_thread opens a real chat in the parent project, linked as a thread, and runs the prompt on Grok build-fast', async () => {
  await withWorld(async (world) => {
    const result = await world.service.spawnThread(world.parentToken, { prompt: 'Проверь тесты модуля оплаты' });

    assert.equal(result.provider, 'grok');
    assert.equal(result.model, 'grok-4.7-build-fast');
    const child = sessionsDb.getSessionById(result.threadId);
    assert.equal(child?.project_path, world.projectA);
    assert.equal(child?.provider, 'grok');

    const links = getSessionLinks(world.parentId, { id: world.member });
    assert.deepEqual(links.children.map((ref) => [ref.sessionId, ref.relation]), [[result.threadId, 'thread']]);

    assert.equal(world.starts.length, 1);
    assert.equal(world.starts[0].sessionId, result.threadId);
    assert.equal(world.starts[0].userId, world.member);
    assert.equal(world.starts[0].parentSessionId, world.parentId);
    assert.equal(world.starts[0].content, 'Проверь тесты модуля оплаты');
    assert.equal(world.starts[0].options.model, 'grok-4.7-build-fast');
    assert.equal(world.starts[0].options.permissionMode, 'acceptEdits', 'the thread runs in the parent run mode');
  });
});

test('the thread is named by its title, or by the start of the prompt', async () => {
  await withWorld(async (world) => {
    const titled = await world.service.spawnThread(world.parentToken, { prompt: 'x', title: 'Тесты оплаты' });
    assert.equal(sessionsDb.getSessionById(titled.threadId)?.custom_name, 'Тесты оплаты');

    const untitled = await world.service.spawnThread(world.parentToken, {
      prompt: 'Собери список всех мест, где вызывается старый API платежей\nи второй строкой детали',
    });
    const name = sessionsDb.getSessionById(untitled.threadId)?.custom_name ?? '';
    assert.ok(name.startsWith('Собери список всех мест'));
    assert.ok(!name.includes('второй строкой'));
    assert.ok(name.length <= 60);
  });
});

test('an empty prompt is refused', async () => {
  await withWorld(async (world) => {
    await refused(world.service.spawnThread(world.parentToken, { prompt: '   ' }), 'PROMPT_REQUIRED');
    assert.equal(world.starts.length, 0);
  });
});

test('a bad or expired token is refused before anything is created', async () => {
  await withWorld(async (world) => {
    const error = await refused(world.service.spawnThread('f'.repeat(64), { prompt: 'x' }), 'TOKEN_INVALID');
    assert.equal(error.status, 401);

    world.tokens.end(world.parentToken);
    world.clockMs.value += 25 * 60 * 60 * 1000;
    await refused(world.service.spawnThread(world.parentToken, { prompt: 'x' }), 'TOKEN_INVALID');
    assert.equal(world.starts.length, 0);
    assert.deepEqual(getSessionLinks(world.parentId, { id: world.admin }).children, []);
  });
});

test('a user who lost access to the project cannot open threads there', async () => {
  await withWorld(async (world) => {
    userProjectAccessDb.revokeAccess(world.member, world.projectAId);
    const error = await refused(world.service.spawnThread(world.parentToken, { prompt: 'x' }), 'ACCESS_DENIED');
    assert.equal(error.status, 403);
    assert.equal(world.starts.length, 0);
  });
});

test('a thread cannot open threads of its own', async () => {
  await withWorld(async (world) => {
    const thread = await world.service.spawnThread(world.parentToken, { prompt: 'x' });
    const threadToken = world.tokens.issue({ sessionId: thread.threadId, userId: world.member })!;
    await refused(world.service.spawnThread(threadToken, { prompt: 'внук' }), 'NESTED_THREAD');
    assert.equal(world.starts.length, 1);
  });
});

test('no more than 3 threads of one parent work at once', async () => {
  await withWorld(async (world) => {
    const first = await world.service.spawnThread(world.parentToken, { prompt: '1' });
    await world.service.spawnThread(world.parentToken, { prompt: '2' });
    await world.service.spawnThread(world.parentToken, { prompt: '3' });
    const error = await refused(world.service.spawnThread(world.parentToken, { prompt: '4' }), 'THREAD_LIMIT');
    assert.match(error.message, /3/);
    assert.equal(world.starts.length, 3);

    finish(world, first.threadId, { state: 'done' }, 'готово');
    await world.service.spawnThread(world.parentToken, { prompt: '4' });
    assert.equal(world.starts.length, 4);
  });
});

test('five simultaneous spawn_thread calls open exactly 3 threads; the other two hit the limit', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await withWorld(async (world) => {
    const calls = Array.from({ length: 5 }, (_, index) =>
      world.service.spawnThread(world.parentToken, { prompt: `задача ${index}` }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      ));
    // Every call is inside its slow catalog lookup before any of them finishes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const outcomes = await Promise.all(calls);

    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 3);
    const refusals = outcomes.filter((outcome) => !outcome.ok);
    assert.equal(refusals.length, 2);
    for (const refusal of refusals) {
      assert.ok(refusal.error instanceof ThreadsError);
      assert.equal(refusal.error.code, 'THREAD_LIMIT');
    }
    assert.equal(world.starts.length, 3);
    assert.equal(getSessionLinks(world.parentId, { id: world.member }).children.length, 3);
  }, { listModels: async () => { await gate; return []; } });
});

test('a failed spawn frees its place', async () => {
  let catalogCalls = 0;
  await withWorld(async (world) => {
    await world.service.spawnThread(world.parentToken, { prompt: '1' });
    await world.service.spawnThread(world.parentToken, { prompt: '2' });
    await assert.rejects(world.service.spawnThread(world.parentToken, { prompt: '3' }));
    await world.service.spawnThread(world.parentToken, { prompt: '3' });
    assert.equal(world.starts.length, 3, 'two working + the retried third fit into the limit');
  }, { listModels: async () => { catalogCalls += 1; if (catalogCalls === 3) throw new Error('каталог недоступен'); return []; } });
});

test('the agent may pick Claude, Codex or a local model; the model must be an allowed one', async () => {
  await withWorld(async (world) => {
    const claude = await world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'claude', model: 'sonnet[1m]' });
    assert.equal(sessionsDb.getSessionById(claude.threadId)?.provider, 'claude');
    assert.equal(world.starts.at(-1)?.options.model, 'sonnet[1m]');

    const codex = await world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'codex' });
    assert.equal(codex.provider, 'codex');
    assert.equal(codex.model, 'gpt-6-sol');

    const local = await world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'local' });
    assert.equal(local.provider, 'claude');
    assert.equal(local.model, 'local-qwen35-9b');

    finish(world, claude.threadId, { state: 'done' });
    await refused(world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'cursor' }), 'PROVIDER_NOT_ALLOWED');
    await refused(world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'grok', model: 'grok-3' }), 'MODEL_NOT_ALLOWED');
    await refused(world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'codex', model: 'gpt-5-mini' }), 'MODEL_NOT_ALLOWED');
  });
});

test('Claude threads obey the 5-hour guard; local models and other engines do not ask it', async () => {
  await withWorld(async (world) => {
    world.limit.blocked = true;
    const error = await refused(
      world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'claude', model: 'opus[1m]' }),
      'CLAUDE_LIMIT',
    );
    assert.match(error.message, /лимит/i);
    assert.equal(world.starts.length, 0);

    const checksBefore = world.limitChecks.length;
    await world.service.spawnThread(world.parentToken, { prompt: 'x', provider: 'claude', model: 'local-ornith-9b' });
    await world.service.spawnThread(world.parentToken, { prompt: 'x' });
    assert.equal(world.limitChecks.length, checksBefore);
    assert.equal(world.starts.length, 2);
  });
});

// --- thread_status ------------------------------------------------------------

test('thread_status reports every thread: working, done with its last reply, waiting with its question', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'A' });
    const b = await world.service.spawnThread(world.parentToken, { prompt: 'b', title: 'B' });
    const c = await world.service.spawnThread(world.parentToken, { prompt: 'c', title: 'C' });
    finish(world, b.threadId, { state: 'done' }, 'Нашёл 4 места, список в docs/api.md');
    finish(world, c.threadId, { state: 'waiting', reason: 'text_question', detail: { question: 'Удалить старый файл?' } });

    const status = await world.service.threadStatus(world.parentToken, {});
    const byId = new Map(status.threads.map((thread) => [thread.threadId, thread]));
    assert.equal(status.working, 1);
    assert.equal(byId.get(a.threadId)?.state, 'working');
    assert.equal(byId.get(a.threadId)?.title, 'A');
    assert.equal(byId.get(b.threadId)?.state, 'done');
    assert.equal(byId.get(b.threadId)?.lastReply, 'Нашёл 4 места, список в docs/api.md');
    assert.equal(byId.get(c.threadId)?.state, 'waiting');
    assert.equal(byId.get(c.threadId)?.question, 'Удалить старый файл?');
  });
});

test('thread_status with wait returns as soon as the threads are settled', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    const startedAt = world.clockMs.value;
    let polls = 0;
    const original = world.running.has.bind(world.running);
    world.running.has = (id: string) => {
      if (id === a.threadId && ++polls >= 3) finish(world, a.threadId, { state: 'done' }, 'ок');
      return original(id);
    };

    const status = await world.service.threadStatus(world.parentToken, { threadId: a.threadId, wait: 300 });
    assert.equal(status.threads[0].state, 'done');
    assert.equal(status.timedOut, false);
    assert.ok(world.clockMs.value - startedAt < 300_000);
  });
});

test('thread_status waits at most 600 seconds', async () => {
  await withWorld(async (world) => {
    await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    const startedAt = world.clockMs.value;
    const status = await world.service.threadStatus(world.parentToken, { wait: 5000 });
    assert.equal(status.timedOut, true);
    assert.equal(status.threads[0].state, 'working');
    const waited = world.clockMs.value - startedAt;
    assert.ok(waited >= 600_000 && waited <= 602_000, `waited ${waited} ms`);
  });
});

test('thread_status and the other tools refuse a chat that is not a thread of this parent', async () => {
  await withWorld(async (world) => {
    sessionsDb.createAppSession('stranger', 'grok', world.projectA);
    await refused(world.service.threadStatus(world.parentToken, { threadId: 'stranger' }), 'THREAD_NOT_FOUND');
    await refused(world.service.messageThread(world.parentToken, { threadId: 'stranger', text: 'x' }), 'THREAD_NOT_FOUND');
    await refused(world.service.stopThread(world.parentToken, { threadId: 'stranger' }), 'THREAD_NOT_FOUND');
    assert.equal(world.starts.length, 0);
    assert.equal(world.aborts.length, 0);
  });
});

// --- message_thread / stop_thread ---------------------------------------------

test('message_thread refuses a busy thread and continues an idle one with the same model', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', provider: 'claude', model: 'fable' });
    const busy = await refused(world.service.messageThread(world.parentToken, { threadId: a.threadId, text: 'ещё' }), 'THREAD_BUSY');
    assert.match(busy.message, /занят/);

    finish(world, a.threadId, { state: 'done' }, 'ок');
    await world.service.messageThread(world.parentToken, { threadId: a.threadId, text: 'Теперь допиши тест' });
    const last = world.starts.at(-1)!;
    assert.equal(last.sessionId, a.threadId);
    assert.equal(last.content, 'Теперь допиши тест');
    assert.equal(last.options.model, 'fable');
  });
});

test('stop_thread stops a working thread and reports an idle one as already stopped', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    assert.deepEqual(await world.service.stopThread(world.parentToken, { threadId: a.threadId }), { threadId: a.threadId, stopped: true });
    assert.deepEqual(world.aborts, [a.threadId]);
    assert.deepEqual(await world.service.stopThread(world.parentToken, { threadId: a.threadId }), { threadId: a.threadId, stopped: false });
    assert.deepEqual(world.aborts, [a.threadId]);
  });
});

// --- «Треды готовы» -----------------------------------------------------------

test('when the parent is idle and all its threads settled, it gets exactly one «Треды готовы» message', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    const b = await world.service.spawnThread(world.parentToken, { prompt: 'b', title: 'Тесты' });

    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 2, 'one thread is still working');

    finish(world, b.threadId, { state: 'failed', reason: 'error', detail: { error: 'упал npm test' } });
    await world.service.handleAttentionChange(b.threadId);
    assert.equal(world.starts.length, 3);
    const message = world.starts[2];
    assert.equal(message.sessionId, world.parentId);
    assert.equal(message.userId, world.member);
    assert.match(message.content, /^Треды готовы/);
    assert.match(message.content, /Поиск/);
    assert.match(message.content, /Нашёл три места/);
    assert.match(message.content, /Тесты/);
    assert.match(message.content, /упал npm test/);

    world.running.delete(world.parentId);
    await world.service.handleAttentionChange(world.parentId);
    await world.service.handleAttentionChange(b.threadId);
    assert.equal(world.starts.length, 3, 'one message per batch');
  });
});

test('a busy parent gets the message only after its own run ends', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    world.running.add(world.parentId);
    finish(world, a.threadId, { state: 'done' }, 'ок');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 1);

    world.attention.set(world.parentId, { state: 'waiting', reason: 'permission' });
    world.running.delete(world.parentId);
    await world.service.handleAttentionChange(world.parentId);
    assert.equal(world.starts.length, 1, 'a parent waiting for an approval is busy too');

    world.attention.set(world.parentId, { state: 'done' });
    await world.service.handleAttentionChange(world.parentId);
    assert.equal(world.starts.length, 2);
    assert.equal(world.starts[1].sessionId, world.parentId);
  });
});

test('a parent waiting for a human answer of any kind gets no message until it is answered', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    finish(world, a.threadId, { state: 'done' }, 'ок');
    for (const reason of ['text_question', 'manual_ask', 'ask']) {
      world.attention.set(world.parentId, { state: 'waiting', reason, detail: { question: 'Делаем?' } });
      await world.service.handleAttentionChange(a.threadId);
      await world.service.handleAttentionChange(world.parentId);
      assert.equal(world.starts.length, 1, `waiting/${reason} defers the message`);
    }
    world.attention.set(world.parentId, { state: 'done' });
    await world.service.handleAttentionChange(world.parentId);
    assert.equal(world.starts.length, 2);
  });
});

test('no message when the parent already read the results with thread_status', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    world.running.add(world.parentId);
    finish(world, a.threadId, { state: 'done' }, 'ок');
    await world.service.threadStatus(world.parentToken, {});

    world.running.delete(world.parentId);
    await world.service.handleAttentionChange(world.parentId);
    assert.equal(world.starts.length, 1);
  });
});

test('a thread that runs again joins the next «Треды готовы» batch', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a' });
    finish(world, a.threadId, { state: 'done' }, 'первый');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 2);
    world.running.delete(world.parentId);

    await world.service.messageThread(world.parentToken, { threadId: a.threadId, text: 'ещё' });
    finish(world, a.threadId, { state: 'done' }, 'второй');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 4);
    assert.match(world.starts[3].content, /второй/);
  });
});

// --- one entry point for the HTTP route -------------------------------------------

test('callTool dispatches the four tools by name and refuses unknown ones', async () => {
  await withWorld(async (world) => {
    const spawned = await world.service.callTool(world.parentToken, 'spawn_thread', { prompt: 'a' }) as { threadId: string };
    const status = await world.service.callTool(world.parentToken, 'thread_status', {}) as { threads: Array<{ threadId: string }> };
    assert.deepEqual(status.threads.map((thread) => thread.threadId), [spawned.threadId]);
    await refused(world.service.callTool(world.parentToken, 'drop_database', {}), 'UNKNOWN_TOOL');
  });
});

// --- Mod switches -------------------------------------------------------------

test('threads switched off mid-run: no new thread or message, in plain words; a running thread still reports back', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });

    world.modsOff.add('modThreads');
    const error = await refused(world.service.spawnThread(world.parentToken, { prompt: 'b' }), 'MOD_OFF');
    assert.match(error.message, /Треды.*выключен в настройках Neo3/);
    assert.equal(error.status, 409);
    await refused(world.service.messageThread(world.parentToken, { threadId: a.threadId, text: 'ещё' }), 'MOD_OFF');
    assert.equal(world.starts.length, 1, 'nothing new started');

    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');
    const status = await world.service.threadStatus(world.parentToken, {});
    assert.equal(status.threads[0].state, 'done', 'thread_status still answers');
  });
});

test('threads switched off: a running thread of the chat can still be stopped', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    world.modsOff.add('modThreads');
    await world.service.stopThread(world.parentToken, { threadId: a.threadId });
    assert.deepEqual(world.aborts, [a.threadId]);
  });
});

test('«Ждут тебя» switched off: threads still open and the parent still gets «Треды готовы»', async () => {
  await withWorld(async (world) => {
    world.modsOff.add('modAttention');
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 2);
    assert.match(world.starts[1].content, /^Треды готовы/);
  });
});

test('a thread already running when threads are switched off finishes and the parent gets its result', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    world.modsOff.add('modThreads');
    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 2);
    assert.equal(world.starts[1].sessionId, world.parentId);
    assert.match(world.starts[1].content, /Нашёл три места/);
  });
});

// --- «Фон доживает до конца»: a held run is alive, not busy ------------------

/** The chat ended its turn with background work alive: its Claude process is kept (up to 2 hours). */
function park(world: World, sessionId: string, phase: 'parked' | 'waiting_helpers', attention: Attention, reply?: string): void {
  world.running.add(sessionId);
  world.phases.set(sessionId, phase);
  world.attention.set(sessionId, attention);
  if (reply) world.replies.set(sessionId, reply);
}

test('a parent whose held run is between turns is not busy: «Треды готовы» goes into it at once — parked or waiting for helpers; a turn that is going still defers it', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    park(world, world.parentId, 'parked', { state: 'done' });
    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');
    await world.service.handleAttentionChange(a.threadId);
    assert.equal(world.starts.length, 2, 'the parent\'s process is alive for its background, the parent itself is free');
    assert.equal(world.starts[1].sessionId, world.parentId);
    assert.match(world.starts[1].content, /^Треды готовы/);

    // The parent works on (the message started a turn): the next batch waits…
    const b = await world.service.spawnThread(world.parentToken, { prompt: 'b', title: 'Тесты' });
    finish(world, b.threadId, { state: 'done' }, 'Тесты зелёные');
    await world.service.handleAttentionChange(b.threadId);
    assert.equal(world.starts.length, 3, 'only the spawn: a turn is going');

    // …until the turn ends. «Ждёт помощников» changes no status — the gateway's turn boundary is the cue.
    park(world, world.parentId, 'waiting_helpers', { state: 'working' });
    await world.service.handleAttentionChange(world.parentId);
    assert.equal(world.starts.length, 4);
    assert.equal(world.starts[3].sessionId, world.parentId);
    assert.match(world.starts[3].content, /Тесты зелёные/);

    // A parked parent that asked the person something still waits for the person.
    const c = await world.service.spawnThread(world.parentToken, { prompt: 'c' });
    finish(world, c.threadId, { state: 'done' }, 'ок');
    park(world, world.parentId, 'parked', { state: 'waiting', reason: 'text_question' });
    await world.service.handleAttentionChange(c.threadId);
    assert.equal(world.starts.length, 5, 'only the spawn');
  });
});

test('a thread a person wrote to and that parked on its background is settled: it does not block «Треды готовы», thread_status does not wait for it, message_thread and stop_thread reach it; one waiting for its helpers still works', async () => {
  await withWorld(async (world) => {
    const a = await world.service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
    const b = await world.service.spawnThread(world.parentToken, { prompt: 'b', title: 'Сборка' });
    finish(world, a.threadId, { state: 'done' }, 'Нашёл три места');

    // Thread B waits for its own helper: it works, the batch is not ready.
    park(world, b.threadId, 'waiting_helpers', { state: 'working' });
    await world.service.handleAttentionChange(b.threadId);
    assert.equal(world.starts.length, 2);
    assert.equal((await world.service.threadStatus(world.parentToken, { threadId: b.threadId })).threads[0].state, 'working');

    // Thread B parked: its answer is ready, only a command of its own is still alive.
    park(world, b.threadId, 'parked', { state: 'done' }, 'Собрал, сервер в фоне');
    await world.service.handleAttentionChange(b.threadId);
    assert.equal(world.starts.length, 3, 'a parked thread does not hold the batch back for two hours');
    assert.equal(world.starts[2].sessionId, world.parentId);
    assert.match(world.starts[2].content, /Нашёл три места/);
    assert.match(world.starts[2].content, /Сборка.+готово: Собрал, сервер в фоне/);

    const startedAt = world.clockMs.value;
    const status = await world.service.threadStatus(world.parentToken, { threadId: b.threadId, wait: 300 });
    assert.equal(status.threads[0].state, 'done');
    assert.equal(status.working, 0);
    assert.equal(world.clockMs.value, startedAt, 'nothing to wait for');

    // The parked thread takes a message (its live process does), and «Стоп» still stops it.
    await world.service.messageThread(world.parentToken, { threadId: b.threadId, text: 'Покажи лог' });
    assert.equal(world.starts.at(-1)?.sessionId, b.threadId);
    park(world, b.threadId, 'parked', { state: 'done' });
    assert.deepEqual(await world.service.stopThread(world.parentToken, { threadId: b.threadId }), { threadId: b.threadId, stopped: true });
  });
});

test('the gateway\'s turn boundary wakes the threads: a held parent gets «Треды готовы» when it goes between turns, and the end of the held run is a cue again', async () => {
  await withWorld(async (world) => {
    const { chatRunRegistry } = await import('@/modules/websocket/index.js');
    const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
    const starts: ThreadRunStart[] = [];
    let parentTakes = false;
    // No fakes for the registry: the phases come from the real one.
    const service = createThreadsService({
      tokens: world.tokens,
      fetchMessages: async () => [],
      checkClaudeLimit: async () => ({ blocked: false }),
      listModels: async () => [],
      broadcastUpsert: () => {},
      isModOn: () => true,
    });
    service.setRunControl({
      start: (input) => {
        starts.push(input);
        return input.sessionId !== world.parentId || parentTakes;
      },
      abort: async () => false,
    });
    // The wiring of server/index.js.
    const unsubscribe = chatRunRegistry.onTurnBoundary((sessionId) => { void service.handleAttentionChange(sessionId); });
    try {
      const thread = await service.spawnThread(world.parentToken, { prompt: 'a', title: 'Поиск' });
      const run = chatRunRegistry.startRun({
        appSessionId: world.parentId,
        provider: 'claude',
        providerSessionId: 'native-parent',
        connection: { readyState: 3, send: () => {} },
        userId: world.member,
      })!;
      await service.handleAttentionChange(thread.threadId);
      assert.equal(starts.length, 1, 'the parent is in a turn');

      // The parent ends its turn with a helper still working: no status change, only the boundary.
      run.writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'Помощник ещё работает.', provider: 'claude', sessionId: world.parentId }));
      const since = new Date().toISOString();
      run.writer.send(createNormalizedMessage({
        kind: 'run_phase' as never,
        phase: 'waiting_helpers',
        since,
        background: { agents: 1, shells: 0 },
        holdUntil: since,
        provider: 'claude',
        sessionId: world.parentId,
      }));
      await settle();
      assert.equal(starts.length, 2, 'between turns the parent is not busy');
      assert.equal(starts[1].sessionId, world.parentId);

      // Its process did not take the message (it was on its way out). The end of the held run is the next cue.
      parentTakes = true;
      run.writer.send(createCompleteMessage({ provider: 'claude', sessionId: world.parentId, exitCode: 0 }));
      await settle();
      assert.equal(starts.length, 3);
      assert.equal(starts[2].sessionId, world.parentId);
      assert.match(starts[2].content, /^Треды готовы/);
    } finally {
      unsubscribe();
      chatRunRegistry.clearAll();
    }
  });
});
