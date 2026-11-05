import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  agentQueueDb,
  agentsDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  AGENT_GONE_REASON,
  createAgentQueueService,
  type AgentQueueDependencies,
  type QueueNotice,
  type QueueRunInput,
  type QueueRunResult,
} from '@/modules/agent-queue/index.js';
import type { ModKey } from '@/shared/mods.js';

import { VERDICT_INSTRUCTION } from '../../../../shared/queue-verdict.js';

type Pending = { input: QueueRunInput; resolve: (result: QueueRunResult) => void; reject: (error: Error) => void };

type World = {
  adminId: number;
  memberId: number;
  project: string;
  agentId: string;
  claudeAgentId: string;
  /** Runs started so far, in order. */
  calls: QueueRunInput[];
  /** Runs still waiting for an answer (manual mode). */
  waiting: Pending[];
  notices: QueueNotice[];
  mods: Map<string, boolean>;
  guard: { blocked: boolean };
  service: ReturnType<typeof createAgentQueueService>;
  /** Answer for every run in auto mode (input → text); throws → engine crash. */
  setAnswer: (answer: ((input: QueueRunInput) => string) | null) => void;
};

async function withWorld(run: (world: World) => Promise<void>, overrides: AgentQueueDependencies = {}): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-queue-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const adminId = Number(userDb.createUserWithRole('dima', 'unused', 'admin').id);
    const memberId = Number(userDb.createUserWithRole('slavik', 'unused', 'user').id);
    const projectDir = path.join(directory, 'tyres');
    await mkdir(projectDir, { recursive: true });
    const project = projectsDb.createProjectPath(projectDir).project!.project_path;
    agentsDb.create({
      id: 'agent-artist', userId: adminId, name: 'Художник', role: 'Перерисовывай карточки шин',
      checks: 'сверь размер на этикетке', provider: 'grok', model: 'grok-4.7-build-fast', effort: null,
      projectPath: project, files: [],
    });
    agentsDb.create({
      id: 'agent-critic', userId: adminId, name: 'Критик', role: 'Проверяй тексты',
      checks: '', provider: 'claude', model: 'opus[1m]', effort: 'high', projectPath: project, files: [],
    });

    const calls: QueueRunInput[] = [];
    const waiting: Pending[] = [];
    const notices: QueueNotice[] = [];
    const mods = new Map<string, boolean>();
    const guard = { blocked: false };
    let answer: ((input: QueueRunInput) => string) | null = () => 'Готово.\nВЕРДИКТ: OK';
    let session = 0;

    const service = createAgentQueueService({
      run: (input) => {
        calls.push(input);
        session += 1;
        const sessionId = `queue-run-${session}`;
        if (!answer) {
          return new Promise<QueueRunResult>((resolve, reject) => {
            waiting.push({ input, resolve, reject });
          });
        }
        try {
          return Promise.resolve({ text: answer(input), sessionId });
        } catch (error) {
          return Promise.reject(error);
        }
      },
      checkUsageGuard: async () => ({ blocked: guard.blocked }),
      notify: (notice) => {
        notices.push(notice);
      },
      isModOn: (_userId, key: ModKey) => mods.get(key) ?? true,
      linkSession: () => {},
      ...overrides,
    });

    await run({
      adminId, memberId, project, agentId: 'agent-artist', claudeAgentId: 'agent-critic',
      calls, waiting, notices, mods, guard, service,
      setAnswer: (next) => { answer = next; },
    });
    await service.idle();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** Ticks until the queue has nothing in work left (auto-answer mode). */
async function drain(world: World, rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await world.service.tick();
    await world.service.idle();
  }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

test('create checks the input: items, lengths, parallel, attempts, agent', async () => {
  await withWorld(async ({ service, adminId, memberId, agentId }) => {
    const base = { agentId, template: 'Перерисуй {{item}}', items: ['a'] };
    assert.throws(() => service.create(adminId, { ...base, items: [] }), code('NO_ITEMS'));
    assert.throws(() => service.create(adminId, { ...base, items: '  \n \n' }), /нет пунктов/i);
    assert.throws(() => service.create(adminId, { ...base, items: Array.from({ length: 501 }, (_, i) => `p${i}`) }), code('TOO_MANY_ITEMS'));
    assert.throws(() => service.create(adminId, { ...base, items: ['x'.repeat(2001)] }), code('ITEM_TOO_LONG'));
    assert.throws(() => service.create(adminId, { ...base, parallel: 0 }), code('QUEUE_INVALID'));
    assert.throws(() => service.create(adminId, { ...base, parallel: 4 }), code('QUEUE_INVALID'));
    assert.throws(() => service.create(adminId, { ...base, maxAttempts: 5 }), code('QUEUE_INVALID'));
    assert.throws(() => service.create(adminId, { ...base, agentId: 'nobody' }), code('AGENT_NOT_FOUND'));
    assert.throws(() => service.create(memberId, base), code('ADMIN_ONLY'));

    const exactly500 = service.create(adminId, { ...base, items: Array.from({ length: 500 }, (_, i) => `p${i}`), parallel: 3, maxAttempts: 4 });
    assert.equal(exactly500.counts.total, 500);
    assert.equal(exactly500.parallel, 3);
    assert.equal(exactly500.maxAttempts, 4);
  });
});

test('create: one item per line, template without {{item}} gets the item at the end', async () => {
  await withWorld(async ({ service, adminId, agentId }) => {
    const queue = service.create(adminId, { agentId, template: 'Сверь этикетку', items: 'Pirelli 205/55\n\n  Ikon 195/65  \n' });
    assert.equal(queue.template, 'Сверь этикетку\n\n{{item}}');
    assert.deepEqual(queue.items.map((item) => item.input), ['Pirelli 205/55', 'Ikon 195/65']);
    assert.deepEqual(queue.items.map((item) => [item.status, item.attempts, item.pass]), [['pending', 0, 1], ['pending', 0, 1]]);
    assert.equal(queue.status, 'running');
    assert.equal(queue.title, 'Художник');
    assert.equal(queue.agentName, 'Художник');
    assert.deepEqual(queue.counts, { pending: 2, running: 0, ok: 0, rejected: 0, total: 2 });
  });
});

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

test('tick takes at most `parallel` items of a queue, with the agent engine and the queue actor', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, project, calls, waiting } = world;
    world.setAnswer(null);
    const queue = service.create(adminId, { agentId, template: 'Перерисуй {{item}} без CDEK', items: ['p1', 'p2', 'p3', 'p4', 'p5'], parallel: 2 });

    await service.tick();
    await service.tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(service.get(adminId, queue.id).counts, { pending: 3, running: 2, ok: 0, rejected: 0, total: 5 });

    const first = calls[0];
    assert.equal(first.actor, 'queue');
    assert.equal(first.provider, 'grok');
    assert.equal(first.model, 'grok-4.7-build-fast');
    assert.equal(first.projectPath, project);
    assert.equal(first.userId, adminId);
    assert.match(first.prompt, /^<agent_brief>[\s\S]*Художник[\s\S]*<\/agent_brief>/);
    assert.ok(first.prompt.includes('Перерисуй p1 без CDEK'));
    assert.ok(first.prompt.endsWith(VERDICT_INSTRUCTION));

    waiting.shift()!.resolve({ text: 'ВЕРДИКТ: OK', sessionId: 's1' });
    await new Promise((resolve) => setImmediate(resolve));
    await service.tick();
    assert.equal(calls.length, 3, 'a freed slot is filled by the next tick');
    for (const pending of waiting.splice(0)) pending.resolve({ text: 'ВЕРДИКТ: OK', sessionId: null });
  });
});

test('no more than 3 queues are in work at once', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls, waiting } = world;
    world.setAnswer(null);
    const queues = [1, 2, 3, 4].map((n) => service.create(adminId, { agentId, template: '{{item}}', items: [`q${n}-a`, `q${n}-b`], parallel: 3 }));

    await service.tick();
    assert.equal(new Set(calls.map((call) => call.prompt.match(/q(\d)-/)?.[1])).size, 3);
    assert.equal(service.get(adminId, queues[3].id).counts.running, 0, 'the fourth queue waits');

    for (const pending of waiting.splice(0)) pending.resolve({ text: 'ВЕРДИКТ: OK', sessionId: null });
    await service.idle();
    await service.tick();
    assert.ok(service.get(adminId, queues[3].id).counts.running > 0, 'a finished queue frees the slot');
    for (const pending of waiting.splice(0)) pending.resolve({ text: 'ВЕРДИКТ: OK', sessionId: null });
  });
});

test('FAIL is redone with the reason of the previous attempt; OK finishes the item', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls } = world;
    let attempt = 0;
    world.setAnswer(() => {
      attempt += 1;
      return attempt === 1 ? 'Сделал.\nВЕРДИКТ: FAIL — размер 205/55 не совпал' : 'Переделал.\n**ВЕРДИКТ: OK**';
    });
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['Pirelli'], maxAttempts: 3 });

    await drain(world);
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].prompt.includes('Прошлая попытка'));
    assert.ok(calls[1].prompt.includes('размер 205/55 не совпал'), 'the retry carries the reason');

    const [item] = service.get(adminId, queue.id).items;
    assert.equal(item.status, 'ok');
    assert.equal(item.attempts, 2);
    assert.equal(item.verdict, 'ok');
    assert.equal(item.sessionId, 'queue-run-2');
    assert.match(String(item.excerpt), /Переделал/);
  });
});

test('after the attempt limit the item goes to «брак» with the last reason and excerpt; no verdict = FAIL', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls } = world;
    let attempt = 0;
    world.setAnswer(() => {
      attempt += 1;
      return attempt === 1 ? 'ВЕРДИКТ: FAIL — мутная этикетка' : 'Нарисовал, но забыл строку вердикта';
    });
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['Ikon'], maxAttempts: 2 });

    await drain(world);
    assert.equal(calls.length, 2, 'two attempts, not more');
    const [item] = service.get(adminId, queue.id).items;
    assert.equal(item.status, 'rejected');
    assert.equal(item.attempts, 2);
    assert.equal(item.verdict, 'fail');
    assert.equal(item.reason, 'нет вердикта');
    assert.equal(item.excerpt, 'Нарисовал, но забыл строку вердикта');
  });
});

test('an engine crash is a FAIL of the attempt with the error text; the queue goes on', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId } = world;
    world.setAnswer((input) => {
      if (input.prompt.includes('broken')) throw new Error('grok exited with code 1');
      return 'ВЕРДИКТ: OK';
    });
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['broken', 'fine'], maxAttempts: 1, parallel: 2 });

    await drain(world);
    const view = service.get(adminId, queue.id);
    assert.deepEqual(view.items.map((item) => item.status), ['rejected', 'ok']);
    assert.match(String(view.items[0].reason), /Сбой движка: grok exited with code 1/);
    assert.equal(view.status, 'done');
  });
});

test('a Claude agent waits while the 5-hour guard says no; other engines do not', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, claudeAgentId, calls, guard } = world;
    guard.blocked = true;
    const claudeQueue = service.create(adminId, { agentId: claudeAgentId, template: '{{item}}', items: ['c1'] });
    service.create(adminId, { agentId, template: '{{item}}', items: ['g1'] });

    await service.tick();
    await service.idle();
    assert.deepEqual(calls.map((call) => call.provider), ['grok']);
    assert.equal(service.get(adminId, claudeQueue.id).counts.pending, 1, 'the Claude item is not taken');

    guard.blocked = false;
    await drain(world);
    assert.deepEqual(calls.map((call) => call.provider), ['grok', 'claude']);
    assert.equal(calls[1].model, 'opus[1m]');
    assert.equal(calls[1].effort, 'high');
  });
});

// ---------------------------------------------------------------------------
// restart and controls
// ---------------------------------------------------------------------------

test('recoverOnBoot returns items «в работе» to the queue; the attempt stays counted', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId } = world;
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a', 'b'], maxAttempts: 2 });
    // A dead process left both in work: «a» on its first attempt, «b» on its last.
    agentQueueDb.claimNext(queue.id);
    const last = agentQueueDb.claimNext(queue.id)!;
    agentQueueDb.finishAttempt(last.id, { status: 'pending', verdict: 'fail', reason: 'x', excerpt: null, sessionId: null });
    agentQueueDb.claimNext(queue.id);

    assert.equal(service.recoverOnBoot(), 2);
    const items = service.get(adminId, queue.id).items;
    assert.deepEqual(items.map((item) => [item.status, item.attempts]), [['pending', 1], ['rejected', 2]]);
    assert.match(String(items[1].reason), /перезапуском/);

    await drain(world);
    assert.equal(service.get(adminId, queue.id).items[0].status, 'ok');
  });
});

test('pause, resume, stop: only a running queue takes items', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls } = world;
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a', 'b'] });

    assert.equal(service.pause(adminId, queue.id).status, 'paused');
    assert.throws(() => service.pause(adminId, queue.id), code('QUEUE_STATE'));
    await drain(world, 2);
    assert.equal(calls.length, 0);

    assert.equal(service.resume(adminId, queue.id).status, 'running');
    await service.tick();
    await service.idle();
    assert.equal(calls.length, 1);

    assert.equal(service.stop(adminId, queue.id).status, 'stopped');
    assert.throws(() => service.resume(adminId, queue.id), code('QUEUE_STATE'));
    await drain(world, 2);
    assert.equal(calls.length, 1, 'a stopped queue takes nothing');
    assert.throws(() => service.pause(world.memberId, queue.id), code('ADMIN_ONLY'));
  });
});

test('«Ещё проход» returns брак with a fresh attempt counter; mark OK by hand', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, notices } = world;
    world.setAnswer(() => 'ВЕРДИКТ: FAIL — криво');
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a', 'b'], maxAttempts: 1 });
    await drain(world);
    assert.equal(service.get(adminId, queue.id).status, 'done');
    assert.equal(notices.length, 1);

    world.setAnswer(() => 'ВЕРДИКТ: OK');
    const again = service.retryRejected(adminId, queue.id);
    assert.equal(again.status, 'running');
    assert.deepEqual(again.items.map((item) => [item.status, item.attempts, item.pass]), [['pending', 0, 2], ['pending', 0, 2]]);
    assert.throws(() => service.retryRejected(adminId, queue.id), code('NO_REJECTED'));

    const marked = await service.markOk(adminId, again.items[1].id);
    assert.equal(marked.items[1].status, 'ok');
    assert.equal(marked.items[1].manual, true);
    await assert.rejects(() => service.markOk(adminId, again.items[1].id), code('ITEM_STATE'));
    await assert.rejects(() => service.markOk(world.memberId, again.items[0].id), code('ADMIN_ONLY'));

    await drain(world);
    const done = service.get(adminId, queue.id);
    assert.equal(done.status, 'done');
    assert.equal(done.items[0].pass, 2);
    assert.equal(notices.length, 2, 'the second pass reports again');
    assert.equal(notices[1].body, '2 OK, 0 брак');
  });
});

// ---------------------------------------------------------------------------
// итог, mod, agent gone
// ---------------------------------------------------------------------------

test('the end of a queue sends one «итог»: N OK, M брак', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, notices } = world;
    world.setAnswer((input) => (input.prompt.includes('плохая') ? 'ВЕРДИКТ: FAIL — нет' : 'ВЕРДИКТ: OK'));
    const queue = service.create(adminId, { agentId, title: 'Pirelli', template: '{{item}}', items: ['хорошая 1', 'хорошая 2', 'плохая'], maxAttempts: 1, parallel: 3 });

    await drain(world);
    assert.deepEqual(notices, [{ code: 'queue.done', userId: adminId, queueId: queue.id, title: 'Конвейер «Pirelli»', body: '2 OK, 1 брак' }]);
    await drain(world, 3);
    assert.equal(notices.length, 1, 'not sent twice');
    assert.ok(service.get(adminId, queue.id).finishedAt);
  });
});

test('mod «Конвейер» off: nothing new is taken, running queues pause, no notice', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls, notices, mods } = world;
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a'] });
    mods.set('modAgentQueue', false);
    await drain(world, 3);
    assert.equal(calls.length, 0);
    assert.equal(service.get(adminId, queue.id).status, 'paused');
    assert.equal(notices.length, 0);

    // «Агенты» off switches the queue off too (requires).
    mods.set('modAgentQueue', true);
    mods.set('modAgents', false);
    service.resume(adminId, queue.id);
    await drain(world, 2);
    assert.equal(calls.length, 0);
    assert.equal(service.get(adminId, queue.id).status, 'paused');
  });
});

test('mod switched off while the last item is in work: the queue ends silently', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, notices, mods, waiting } = world;
    world.setAnswer(null);
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a'] });
    await service.tick();
    mods.set('modAgentQueue', false);
    waiting.shift()!.resolve({ text: 'ВЕРДИКТ: OK', sessionId: null });
    await service.idle();
    assert.equal(service.get(adminId, queue.id).status, 'done');
    assert.equal(notices.length, 0);
  });
});

test('a deleted agent: the waiting items go to брак with the reason, the queue finishes', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId, calls, notices } = world;
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a', 'b'] });
    agentsDb.delete(agentId);
    await drain(world, 2);
    assert.equal(calls.length, 0);
    const view = service.get(adminId, queue.id);
    assert.equal(view.agentName, null);
    assert.deepEqual(view.items.map((item) => [item.status, item.reason]), [['rejected', AGENT_GONE_REASON], ['rejected', AGENT_GONE_REASON]]);
    assert.equal(view.status, 'done');
    assert.equal(notices[0]?.body, '0 OK, 2 брак');
  });
});

test('a queue of another user does not exist for you; remove deletes items', async () => {
  await withWorld(async (world) => {
    const { service, adminId, agentId } = world;
    const otherAdmin = Number(userDb.createUserWithRole('second', 'unused', 'admin').id);
    const queue = service.create(adminId, { agentId, template: '{{item}}', items: ['a'] });
    assert.throws(() => service.get(otherAdmin, queue.id), code('QUEUE_NOT_FOUND'));
    assert.deepEqual(service.list(otherAdmin), []);
    assert.equal(service.list(adminId).length, 1);
    service.remove(adminId, queue.id);
    assert.equal(agentQueueDb.items(queue.id).length, 0);
    assert.throws(() => service.get(adminId, queue.id), code('QUEUE_NOT_FOUND'));
  });
});
