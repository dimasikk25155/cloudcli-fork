import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, queuedMessagesDb } from '@/modules/database/index.js';
import {
  createQueuedMessagesService,
  type QueueAttention,
  type QueuedSendInput,
  type QueuedSendOutcome,
} from '@/modules/queued-messages/index.js';
import { formatChatEvent } from '@/shared/chat-event-log.js';

// The queue's own decisions, on fakes: the chat gateway (`sendAsUser`,
// `isRunLive`, `abortRun`) and the chat status (`getAttention`) are stand-ins,
// the cell is the real table in a throwaway database.

const DIMA = 7;
const AT = '2026-11-23T16:02:21.000Z';

type World = {
  service: ReturnType<typeof createQueuedMessagesService>;
  sent: QueuedSendInput[];
  aborts: Array<{ sessionId: string; userId: number | null }>;
  /** Seen right after the aborted turn was reported, before the stop settled. */
  duringAbort: Array<{ sent: number; holdReason: string | null | undefined }>;
  changed: string[];
  lines: string[];
  /** What the fake gateway answers to the next send. */
  outcome: QueuedSendOutcome;
  live: boolean;
  /** Phase of the chat's live run as the gateway reports it (null = no live run). */
  phase: 'running' | 'waiting_helpers' | 'parked' | null;
  attention: QueueAttention | null;
  /** What the engine's limit on new runs answers, in worlds that have one: a reason, or null = go. */
  limit: string | null;
  limitAsked: number;
  /** The turn ended (or changed its status): tell the queue like session-attention does. */
  turn(attention: QueueAttention, live?: boolean): Promise<void>;
};

async function withWorld(run: (world: World) => Promise<void>, options: { withLimit?: boolean } = {}): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'queued-messages-service-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    const world: World = {
      service: null as unknown as World['service'],
      sent: [],
      aborts: [],
      duringAbort: [],
      changed: [],
      lines: [],
      outcome: { started: true },
      live: true,
      phase: 'running',
      attention: { state: 'working' },
      limit: null,
      limitAsked: 0,
      async turn(attention, live = false) {
        world.attention = attention;
        world.live = live;
        await world.service.handleAttentionChange('chat-1');
      },
    };
    world.service = createQueuedMessagesService({
      db: queuedMessagesDb,
      sendAsUser: (input) => {
        world.sent.push(input);
        if (world.outcome.started) {
          // A started run: the chat is busy again.
          world.live = true;
          world.phase = 'running';
          world.attention = { state: 'working' };
        }
        return world.outcome;
      },
      ...(options.withLimit ? {
        checkSendLimit: () => {
          world.limitAsked += 1;
          return world.limit;
        },
      } : {}),
      getAttention: () => world.attention,
      isRunLive: () => world.live,
      runPhase: () => world.phase,
      abortRun: async (sessionId, userId) => {
        world.aborts.push({ sessionId, userId });
        // «Стоп»: the gateway completes the run as aborted first, the status
        // listener hears it, and only then the engine is told to stop.
        await world.turn({ state: 'done', stopped: true });
        world.duringAbort.push({ sent: world.sent.length, holdReason: world.service.get(sessionId)?.holdReason });
        return true;
      },
      notifyChanged: (sessionId) => { world.changed.push(sessionId); },
      now: () => new Date(AT),
      log: (event, fields) => { world.lines.push(formatChatEvent(event, fields, new Date(AT))); },
    });
    await run(world);
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const MESSAGE = {
  content: 'Когда закончишь — выкати на прод',
  options: { model: 'opus[1m]', effort: 'high', permissionMode: 'bypassPermissions' },
  images: [{ path: 'shot-1.png', name: 'экран.png' }],
};

test('put during a turn keeps the message on the server; get returns it; clear removes it', async () => {
  await withWorld(async (world) => {
    const { queued, sent } = await world.service.put('chat-1', DIMA, MESSAGE);
    assert.equal(sent, false);
    assert.deepEqual(queued, {
      sessionId: 'chat-1',
      content: MESSAGE.content,
      options: MESSAGE.options,
      images: MESSAGE.images,
      createdAt: AT,
      updatedAt: AT,
      holdReason: null,
      lastError: null,
    });
    assert.deepEqual(world.service.get('chat-1'), queued);
    assert.equal(world.sent.length, 0, 'the turn is still going: nothing is sent');
    assert.deepEqual(world.changed, ['chat-1']);

    assert.equal(world.service.clear('chat-1'), true);
    assert.equal(world.service.get('chat-1'), null);
    assert.deepEqual(world.changed, ['chat-1', 'chat-1']);
    // Nothing to clear: no frame for nothing.
    assert.equal(world.service.clear('chat-1'), false);
    assert.equal(world.changed.length, 2);
  });
});

test('an empty message is refused; pictures alone are a message', async () => {
  await withWorld(async (world) => {
    await assert.rejects(world.service.put('chat-1', DIMA, { content: '   ' }), { statusCode: 400, code: 'QUEUED_MESSAGE_EMPTY' });
    await assert.rejects(world.service.put('chat-1', DIMA, { content: 42 as unknown as string }), { statusCode: 400 });
    await assert.rejects(world.service.put('chat-1', DIMA, { content: 'x', options: [] as unknown as Record<string, unknown> }), { statusCode: 400 });
    assert.equal(world.service.get('chat-1'), null);

    const { queued } = await world.service.put('chat-1', DIMA, { content: '', images: MESSAGE.images });
    assert.deepEqual(queued?.images, MESSAGE.images);
  });
});

test('the turn ended with «готово»: the server sends the queued message itself, as the user who queued it', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'done' });

    assert.deepEqual(world.sent, [{
      sessionId: 'chat-1',
      userId: DIMA,
      content: MESSAGE.content,
      options: MESSAGE.options,
      images: MESSAGE.images,
    }]);
    assert.equal(world.service.get('chat-1'), null, 'the queue is empty after the send');
    assert.deepEqual(world.changed, ['chat-1', 'chat-1']);

    // The status of the new run, and its end, send nothing more.
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 1);
  });
});

test('the agent waits for the user: the message is held as «question» and goes once the answered turn is done', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    // A permission request: the run is alive, the chat «ждёт тебя».
    await world.turn({ state: 'waiting' }, true);
    assert.equal(world.service.get('chat-1')?.holdReason, 'question');
    assert.equal(world.sent.length, 0);

    // The user answered, the agent works on.
    await world.turn({ state: 'working' }, true);
    assert.equal(world.service.get('chat-1')?.holdReason, null);
    assert.equal(world.sent.length, 0);

    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 1);
    assert.equal(world.service.get('chat-1'), null);
  });
});

test('a turn that ended with a question to the user keeps the message: nothing is sent while the chat «ждёт тебя»', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'waiting' });
    await world.turn({ state: 'waiting' });
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.holdReason, 'question');
    assert.equal(world.service.get('chat-1')?.lastError, null);
  });
});

test('an engine error holds the message as «failed», «Стоп» as «stopped»; neither goes out later by itself', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'failed' });
    assert.equal(world.service.get('chat-1')?.holdReason, 'failed');

    // The user starts another turn by hand; it ends well — the held message stays.
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.holdReason, 'failed');

    // A fresh message during the next turn, then «Стоп».
    world.live = true;
    world.attention = { state: 'working' };
    await world.service.put('chat-1', DIMA, { content: 'третье' });
    assert.equal(world.service.get('chat-1')?.holdReason, null);
    await world.turn({ state: 'done', stopped: true });
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.holdReason, 'stopped');
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.content, 'третье');
  });
});

test('put with no live run and no open question sends at once; with an open question it is held', async () => {
  await withWorld(async (world) => {
    world.live = false;
    world.attention = { state: 'done' };
    const sentNow = await world.service.put('chat-1', DIMA, MESSAGE);
    assert.deepEqual(sentNow, { queued: null, sent: true });
    assert.equal(world.sent.length, 1);
    assert.equal(world.service.get('chat-1'), null);

    // A chat nobody ran yet has no status at all: also sent at once.
    world.live = false;
    world.attention = null;
    assert.equal((await world.service.put('chat-1', DIMA, { content: 'первое сообщение' })).sent, true);

    world.live = false;
    world.attention = { state: 'waiting' };
    const held = await world.service.put('chat-1', DIMA, { content: 'ответ потом' });
    assert.equal(held.sent, false);
    assert.equal(held.queued?.holdReason, 'question');
    assert.equal(world.sent.length, 2);
  });
});

test('send-now during a turn: the server stops the turn itself and sends after the stop — not «stopped»', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    const result = await world.service.sendNow('chat-1', DIMA);

    assert.deepEqual(world.aborts, [{ sessionId: 'chat-1', userId: DIMA }]);
    // While the turn was being stopped: not sent yet, and not parked as «stopped».
    assert.deepEqual(world.duringAbort, [{ sent: 0, holdReason: null }]);
    assert.equal(result.sent, true);
    assert.equal(world.sent.length, 1, 'sent exactly once, after the stop');
    assert.equal(world.sent[0].content, MESSAGE.content);
    assert.equal(world.service.get('chat-1'), null);
  });
});

test('send-now without a live run sends at once, even a held message; nothing queued → 404', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'done', stopped: true });
    assert.equal(world.service.get('chat-1')?.holdReason, 'stopped');

    const result = await world.service.sendNow('chat-1', DIMA);
    assert.equal(result.sent, true);
    assert.equal(world.aborts.length, 0);
    assert.equal(world.sent.length, 1);
    assert.equal(world.service.get('chat-1'), null);

    await assert.rejects(world.service.sendNow('chat-1', DIMA), { statusCode: 404, code: 'QUEUED_MESSAGE_NOT_FOUND' });
  });
});

test('a failed send keeps the message with «error» and a reason for a person; no retries on their own', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    world.outcome = { started: false, busy: false, error: 'Нет доступа к проекту этого чата' };
    await world.turn({ state: 'done' });

    const held = world.service.get('chat-1');
    assert.equal(held?.holdReason, 'error');
    assert.equal(held?.lastError, 'Нет доступа к проекту этого чата');
    assert.equal(held?.content, MESSAGE.content);
    assert.equal(world.sent.length, 1);

    // More status changes of the chat: the queue does not try again by itself.
    await world.turn({ state: 'done' });
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 1);

    // The user presses «отправить»: one more try, this time it starts.
    world.outcome = { started: true };
    assert.equal((await world.service.sendNow('chat-1', DIMA)).sent, true);
    assert.equal(world.sent.length, 2);
    assert.equal(world.service.get('chat-1'), null);
  });
});

test('a gateway that throws is a failed send too: the message stays, the error is told', async () => {
  await withWorld(async (world) => {
    world.live = false;
    world.attention = { state: 'done' };
    const service = createQueuedMessagesService({
      db: queuedMessagesDb,
      sendAsUser: () => { throw new Error('spawn ENOENT'); },
      getAttention: () => world.attention,
      isRunLive: () => false,
      abortRun: () => false,
      now: () => new Date(AT),
      log: () => {},
    });
    const result = await service.put('chat-1', DIMA, MESSAGE);
    assert.equal(result.sent, false);
    assert.equal(result.queued?.holdReason, 'error');
    assert.match(result.queued?.lastError ?? '', /Не удалось отправить/);
  });
});

test('the chat got busy with someone else\'s run: the message waits for that run, without a hold', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    // The auto-relay (or «Треды готовы») took the chat first.
    world.outcome = { started: false, busy: true, error: 'В чате уже идёт ход' };
    await world.turn({ state: 'done' });
    assert.equal(world.service.get('chat-1')?.holdReason, null);
    assert.equal(world.service.get('chat-1')?.lastError, null);

    world.outcome = { started: true };
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 2);
    assert.equal(world.service.get('chat-1'), null);
  });
});

test('a run someone else already started when «готово» is heard: nothing is sent into it', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'done' }, true);
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.holdReason, null);
  });
});

test('after a server restart the queued message stays, marked «restart», and does not go by itself', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    assert.equal(world.service.recoverOnBoot(), 1);
    assert.equal(world.service.get('chat-1')?.holdReason, 'restart');
    assert.equal(world.service.get('chat-1')?.content, MESSAGE.content);

    // The boot reconcile marks the dead run failed, later turns end — still held.
    await world.turn({ state: 'failed' });
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 0);
    assert.equal(world.service.get('chat-1')?.holdReason, 'restart');
  });
});

test('every change of the queue tells the chat with a frame: put, hold, lifted hold, send, clear, restart', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    assert.equal(world.changed.length, 1);
    await world.turn({ state: 'waiting' }, true);
    assert.equal(world.changed.length, 2);
    // The same status again changes nothing — no frame.
    await world.turn({ state: 'waiting' }, true);
    assert.equal(world.changed.length, 2);
    await world.turn({ state: 'working' }, true);
    assert.equal(world.changed.length, 3);
    await world.turn({ state: 'done' });
    assert.equal(world.changed.length, 4);

    await world.service.put('chat-1', DIMA, MESSAGE);
    assert.equal(world.changed.length, 5);
    world.service.recoverOnBoot();
    assert.equal(world.changed.length, 6);
    world.service.clear('chat-1');
    assert.equal(world.changed.length, 7);
    assert.deepEqual([...new Set(world.changed)], ['chat-1']);
  });
});

test('the journal gets queue_put, queue_hold and queue_send with the chat and the user — never the message text', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    await world.turn({ state: 'waiting' }, true);
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });

    assert.deepEqual(world.lines, [
      `[chat] ${AT} queue_put session=chat-1 user=${DIMA} chars=${MESSAGE.content.length} images=1 live=true`,
      `[chat] ${AT} queue_hold session=chat-1 user=${DIMA} reason=question`,
      `[chat] ${AT} queue_send session=chat-1 user=${DIMA} manual=false`,
    ]);
    for (const line of world.lines) {
      assert.doesNotMatch(line, /выкати|закончишь|opus|экран/);
    }
  });
});

test('a message edited while its previous text was being sent stays queued for the next turn end', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, { content: 'первая версия' });
    let service = world.service;
    let release: (outcome: QueuedSendOutcome) => void = () => {};
    service = createQueuedMessagesService({
      db: queuedMessagesDb,
      sendAsUser: (input) => {
        world.sent.push(input);
        return new Promise<QueuedSendOutcome>((resolve) => { release = resolve; });
      },
      getAttention: () => ({ state: 'done' }),
      isRunLive: () => false,
      abortRun: () => false,
      now: () => new Date('2026-11-23T16:03:00.000Z'),
      log: () => {},
    });

    const sending = service.handleAttentionChange('chat-1');
    // While the gateway is starting the run, the status changes again and the user edits the text.
    await service.handleAttentionChange('chat-1');
    assert.equal(world.sent.length, 1, 'one send at a time per chat');
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: DIMA, content: 'вторая версия', optionsJson: null, imagesJson: null, at: '2026-11-23T16:03:01.000Z' });
    release({ started: true });
    await sending;

    assert.equal(world.sent[0].content, 'первая версия');
    assert.equal(service.get('chat-1')?.content, 'вторая версия');
  });
});

// «Фон доживает до конца»: a Claude process kept for its background is
// between turns, not busy — the gateway reports `isRunLive: false` and the phase.

test('«ждёт помощников»: the status stays «работает», but the turn is over — the queued message goes into the live process; a sticky hold still waits for the user', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, MESSAGE);
    assert.equal(world.sent.length, 0, 'mid-turn: queued');

    // The gateway's cue on the turn boundary: no status change came with it.
    world.live = false;
    world.phase = 'waiting_helpers';
    await world.service.handleAttentionChange('chat-1');
    assert.equal(world.sent.length, 1);
    assert.equal(world.sent[0].content, MESSAGE.content);
    assert.equal(world.service.get('chat-1'), null);
    assert.deepEqual(world.aborts, [], 'nothing is stopped: that would kill the helpers');

    // «Работает» without the phase (the status is still being settled) sends nothing.
    await world.service.put('chat-1', DIMA, MESSAGE);
    world.live = false;
    world.phase = null;
    await world.service.handleAttentionChange('chat-1');
    assert.equal(world.sent.length, 1);

    // A message the user must act on stays, whatever the phase.
    await world.turn({ state: 'failed' });
    assert.equal(world.service.get('chat-1')?.holdReason, 'failed');
    world.attention = { state: 'working' };
    world.phase = 'waiting_helpers';
    await world.service.handleAttentionChange('chat-1');
    assert.equal(world.sent.length, 1);
    assert.equal(world.service.get('chat-1')?.holdReason, 'failed');
  });
});

// Ремонт ветки (F1): a message that was SENT must not be lost when the live
// process could not take it, and a refused limit must not eat a queued one.

test('a sent message the live process could not take is kept and leaves when that run ends — also when the chat «ждёт тебя»; its bubble is already drawn', async () => {
  await withWorld(async (world) => {
    // Between turns, the agent asked a question, the process is on its way out.
    world.live = false;
    world.phase = 'parked';
    world.attention = { state: 'waiting' };
    const kept = world.service.deferSent('chat-1', DIMA, MESSAGE);
    assert.equal(kept.content, MESSAGE.content);
    assert.equal(kept.holdReason, null, 'it is the answer, not a message for later');
    assert.equal(world.sent.length, 0, 'the gateway has just refused it: no second try at once');
    assert.deepEqual(world.changed, ['chat-1'], 'the card is told');
    assert.match(world.lines.join('\n'), /queue_put session=chat-1 user=7/);

    // The run ended. The status says nothing new (it was settled when the turn parked).
    world.phase = null;
    await world.service.handleAttentionChange('chat-1');
    assert.equal(world.sent.length, 1, 'sent although the chat «ждёт тебя»');
    assert.deepEqual(world.sent[0], {
      sessionId: 'chat-1',
      userId: DIMA,
      content: MESSAGE.content,
      options: MESSAGE.options,
      images: MESSAGE.images,
      echoed: true,
    });
    assert.equal(world.service.get('chat-1'), null);
  });
});

test('a kept sent message waits out a turn the agent started by itself, stops being special once the user edits it, and is held by «Стоп»', async () => {
  await withWorld(async (world) => {
    // The agent woke up by itself: a turn is going.
    world.service.deferSent('chat-1', DIMA, { content: 'ответ' });
    await world.turn({ state: 'working' }, true);
    assert.equal(world.sent.length, 0, 'nothing is written into a running turn');
    world.phase = 'parked';
    await world.turn({ state: 'waiting' });
    assert.equal(world.sent.length, 1, 'the turn is over: it goes, whatever the agent asked');
    assert.equal(world.service.get('chat-1'), null);

    // An edit in the card is a queued message like any other.
    world.live = false;
    world.phase = null;
    world.attention = { state: 'waiting' };
    world.service.deferSent('chat-1', DIMA, { content: 'черновик' });
    await world.service.put('chat-1', DIMA, { content: 'поправил' });
    assert.equal(world.service.get('chat-1')?.holdReason, 'question');
    assert.equal(world.sent.length, 1);
    world.service.clear('chat-1');

    // «Стоп» before the run ended: the user decides.
    world.service.deferSent('chat-1', DIMA, { content: 'ещё' });
    await world.turn({ state: 'done', stopped: true });
    assert.equal(world.service.get('chat-1')?.holdReason, 'stopped');
    assert.equal(world.sent.length, 1);
  });
});

test('a sent message never replaces what the queue already holds: both texts stay in the card, and a hold only the user lifts stays', async () => {
  await withWorld(async (world) => {
    await world.service.put('chat-1', DIMA, { content: 'После сборки выкати', images: [{ path: 'a.png' }] });
    await world.turn({ state: 'done', stopped: true });
    assert.equal(world.service.get('chat-1')?.holdReason, 'stopped');

    world.live = false;
    world.phase = 'parked';
    const kept = world.service.deferSent('chat-1', DIMA, { content: 'Покажи лог', options: { permissionMode: 'plan' }, images: [{ path: 'b.png' }] });
    assert.equal(kept.content, 'После сборки выкати\n\nПокажи лог');
    assert.deepEqual(kept.images, [{ path: 'a.png' }, { path: 'b.png' }]);
    assert.deepEqual(kept.options, { permissionMode: 'plan' });
    assert.equal(kept.holdReason, 'stopped', 'what waited for the user still waits for the user');

    world.phase = null;
    await world.turn({ state: 'done' });
    assert.equal(world.sent.length, 0);
    assert.equal((await world.service.sendNow('chat-1', DIMA)).sent, true);
    assert.equal(world.sent[0].content, 'После сборки выкати\n\nПокажи лог');
    assert.equal('echoed' in world.sent[0], false, 'nobody drew a bubble with both texts');
  });
});

test('the engine\'s limit refuses new runs: the message stays in its card as «error» with the reason in Russian, nothing retries, «отправить» runs it anyway', async () => {
  await withWorld(async (world) => {
    const reason = 'Использовано 95% 5-часового лимита подписки Claude — новые прогоны придержаны до 21:00 МСК. Нажми «Отправить», чтобы запустить всё равно.';
    await world.service.put('chat-1', DIMA, MESSAGE);
    world.limit = reason;
    await world.turn({ state: 'done' });

    assert.equal(world.sent.length, 0, 'no run was started, so none could swallow the message');
    const held = world.service.get('chat-1');
    assert.equal(held?.content, MESSAGE.content);
    assert.equal(held?.holdReason, 'error');
    assert.equal(held?.lastError, reason);
    assert.match(world.lines.join('\n'), /queue_hold session=chat-1 user=7 reason=error/);

    // The queue does not ask again by itself.
    const asked = world.limitAsked;
    await world.turn({ state: 'done' });
    await world.turn({ state: 'working' }, true);
    await world.turn({ state: 'done' });
    assert.equal(world.limitAsked, asked);
    assert.equal(world.sent.length, 0);

    // «Отправить» on that card is the user's «run anyway»: the limit is not asked, the runtime is told.
    const result = await world.service.sendNow('chat-1', DIMA);
    assert.equal(result.sent, true);
    assert.equal(world.limitAsked, asked);
    assert.deepEqual(world.sent[0].options, { ...MESSAGE.options, usageGuardOverride: true });
    assert.equal(world.service.get('chat-1'), null);
  }, { withLimit: true });
});

test('a limit that lets the run through is not asked a second time by the runtime; a refused card that was edited is asked again', async () => {
  await withWorld(async (world) => {
    world.live = false;
    world.attention = { state: 'done' };
    assert.equal((await world.service.put('chat-1', DIMA, MESSAGE)).sent, true);
    assert.equal(world.limitAsked, 1);
    assert.deepEqual(world.sent[0].options, { ...MESSAGE.options, usageGuardOverride: true });

    // Refused, then edited: «отправить» on the new text is not a confirmation of the old refusal.
    world.live = false;
    world.attention = { state: 'done' };
    world.limit = 'Лимит подписки почти исчерпан';
    assert.equal((await world.service.put('chat-1', DIMA, MESSAGE)).queued?.holdReason, 'error');
    world.live = true;
    await world.service.put('chat-1', DIMA, { content: 'другой текст' });
    world.live = false;
    const again = await world.service.sendNow('chat-1', DIMA);
    assert.equal(again.sent, false);
    assert.equal(again.queued?.holdReason, 'error');
    assert.equal(world.sent.length, 1);

    // A check that throws never blocks.
    const service = createQueuedMessagesService({
      db: queuedMessagesDb,
      sendAsUser: (input) => { world.sent.push(input); return { started: true }; },
      checkSendLimit: () => { throw new Error('usage endpoint is down'); },
      getAttention: () => ({ state: 'done' }),
      isRunLive: () => false,
      abortRun: () => false,
      log: () => {},
    });
    assert.equal((await service.put('chat-2', DIMA, { content: 'проверка упала' })).sent, true);
  }, { withLimit: true });
});

// Повторное ревью F1: the cell is one per chat, but its message belongs to
// whoever queued it — it is sent on their behalf, in their sandbox.
test('a sent message is never glued to another user\'s queued one: the cell stays as it was and leaves as its own user, the sender is refused in plain words', async () => {
  await withWorld(async (world) => {
    const SLAVIK = 8;
    const queued = { content: 'Собери отчёт', options: { permissionMode: 'default' }, images: [{ path: 'slavik.png' }] };
    await world.service.put('chat-1', SLAVIK, queued);
    const before = world.service.get('chat-1');
    const frames = world.changed.length;

    world.live = false;
    world.phase = 'parked';
    assert.throws(
      () => world.service.deferSent('chat-1', DIMA, { content: 'Выкати на прод', options: { permissionMode: 'bypassPermissions' } }),
      (error: { statusCode?: number; code?: string; message?: string }) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, 'QUEUED_MESSAGE_FOREIGN');
        assert.match(String(error.message), /сообщение другого участника/);
        assert.match(String(error.message), /не отправлено/);
        return true;
      },
    );
    assert.deepEqual(world.service.get('chat-1'), before, 'not a byte of the cell changed');
    assert.equal(world.changed.length, frames, 'nothing to re-read');

    // The run ends: the teammate's text goes alone, as the teammate, with the teammate's mode.
    world.phase = null;
    await world.turn({ state: 'done' });
    assert.deepEqual(world.sent, [{ sessionId: 'chat-1', userId: SLAVIK, content: queued.content, options: queued.options, images: queued.images }]);

    // A message whose owner is unknown is nobody's to glue to either.
    queuedMessagesDb.put({ sessionId: 'chat-1', userId: null, content: 'ничьё', optionsJson: null, imagesJson: null, at: '2026-11-23T16:05:00.000Z' });
    assert.throws(() => world.service.deferSent('chat-1', null, { content: 'тоже ничьё' }), { code: 'QUEUED_MESSAGE_FOREIGN' });
    assert.equal(world.service.get('chat-1')?.content, 'ничьё');
  });
});
