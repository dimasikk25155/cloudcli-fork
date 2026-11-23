import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionAttentionDb,
  sessionsDb,
  uiPreferencesDb,
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import {
  queuedAttentionListener,
  queuedMessagesService,
  setQueuedSendControl,
} from '@/modules/queued-messages/index.js';
import { sessionAttention } from '@/modules/session-attention/index.js';
// Loaded up front: the queue reaches its frame through a lazy import of this barrel.
import { notifyQueuedMessageChanged } from '@/modules/websocket/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  createAutoRelayRunControl,
  createIdeaRunControl,
  createQueuedSendControl,
  createThreadRunControl,
  handleChatConnection,
} from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

// «Фон доживает до конца» at the chat gateway: real run registry, real chat
// status («Ждут тебя»), the production wiring of the queue. The Claude runtime
// is a stand-in that behaves like server/claude-sdk.js does on a held run:
// it reports the phase (`run_phase`) and takes a message only between turns.

type Writer = { send(data: unknown): void };
type Spawn = { command: string; options: Record<string, unknown>; writer: Writer; finish(): void };
type HeldPayload = {
  command: string;
  images?: unknown[];
  autoRelayNoteDir?: string | null;
  model?: string;
  effort?: string;
  permissionMode?: string;
};
type Runtime = {
  /** The live process is between turns and holds its input. */
  accepting: boolean;
  taken: HeldPayload[];
  released: string[];
  tasks: Array<{ taskId: string; kind: string }>;
  /**
   * Permission mode the live process was started with. Like the real runtime,
   * the stand-in takes no message that asks for another one and lets go of
   * the hold instead (null = it does not look).
   */
  processMode: string | null;
};
type Fixture = {
  dima: number;
  slavik: number;
  spawns: Spawn[];
  aborted: string[];
  runtime: Runtime;
  dependencies: Parameters<typeof createQueuedSendControl>[0];
  control: ReturnType<typeof createQueuedSendControl>;
  /** What the fake jail answers for a user id (default: nobody is fenced). */
  jails: Map<number, unknown>;
  holdMs: { value: number };
  /** Claude's 5-hour guard as the gateway is told (default: not blocked). */
  guard: { blocked: boolean; pct: number | null; threshold: number; resetsAt: string | null; asked: number };
};

const CHAT = 'claude-native-1';
const BASH = { taskId: 'b1', kind: 'bash' };
const AGENT = { taskId: 'a1', kind: 'agent' };

assert.equal(typeof notifyQueuedMessageChanged, 'function');

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function phaseFrame(phase: 'running' | 'waiting_helpers' | 'parked', tasks: Runtime['tasks']) {
  const since = new Date().toISOString();
  return createNormalizedMessage({
    kind: 'run_phase' as never,
    phase,
    since,
    background: {
      agents: tasks.filter((task) => task.kind === 'agent').length,
      shells: tasks.filter((task) => task.kind !== 'agent').length,
    },
    ...(phase === 'running' ? {} : { holdUntil: new Date(Date.parse(since) + 7_200_000).toISOString() }),
    provider: 'claude',
    sessionId: CHAT,
  });
}

async function withWorld(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-background-hold-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();

  const spawns: Spawn[] = [];
  const aborted: string[] = [];
  const jails = new Map<number, unknown>();
  const holdMs = { value: 7_200_000 };
  const runtime: Runtime = { accepting: false, taken: [], released: [], tasks: [], processMode: null };
  const guard: Fixture['guard'] = { blocked: false, pct: 12, threshold: 90, resetsAt: '2026-11-23T18:00:00.000Z', asked: 0 };
  const spawn = (command: string, options: Record<string, unknown>, writer: Writer) => {
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    spawns.push({ command, options, writer, finish });
    return done;
  };
  const dependencies = {
    userJailFor: (userId: number) => jails.get(Number(userId)) ?? null,
    spawnFns: { claude: spawn },
    abortFns: {
      claude: async (providerSessionId: string) => { aborted.push(providerSessionId); return true; },
    },
    backgroundTasksFns: { claude: () => runtime.tasks },
    // Like sendToHeldClaudeRun: taken only between turns, and the chat is told «running» at once.
    heldInputFns: {
      claude: (_providerSessionId: string, payload: HeldPayload) => {
        if (!runtime.accepting) return false;
        if (runtime.processMode && payload.permissionMode !== undefined && payload.permissionMode !== runtime.processMode) {
          runtime.released.push(_providerSessionId);
          runtime.accepting = false;
          return false;
        }
        runtime.accepting = false;
        runtime.taken.push(payload);
        spawns.at(-1)!.writer.send(phaseFrame('running', []));
        return true;
      },
    },
    releaseHeldFns: {
      claude: (providerSessionId: string) => { runtime.released.push(providerSessionId); runtime.accepting = false; return true; },
    },
    backgroundHoldMs: () => holdMs.value,
    usageGuardFns: {
      claude: async () => {
        guard.asked += 1;
        return { blocked: guard.blocked, pct: guard.pct, threshold: guard.threshold, resetsAt: guard.resetsAt };
      },
    },
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
  } as unknown as Parameters<typeof createQueuedSendControl>[0];
  const control = createQueuedSendControl(dependencies);
  setQueuedSendControl(control);
  const pokeQueue = queuedAttentionListener();
  const unsubscribe = sessionAttention.onChange(pokeQueue);
  // The wiring of server/index.js: a turn boundary of a live run is also the queue's cue.
  const unsubscribeBoundary = chatRunRegistry.onTurnBoundary((sessionId) => pokeQueue({ sessionId }));

  try {
    const dima = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const slavik = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const project = projectsDb.createProjectPath('/workspace/hold-run').project!;
    userProjectAccessDb.grantAccess(slavik, project.project_id, dima);
    assert.equal(sessionsDb.createSession(CHAT, 'claude', project.project_path, 'Сборка'), CHAT);
    await runTest({ dima, slavik, spawns, aborted, runtime, dependencies, control, jails, holdMs, guard });
  } finally {
    await settle();
    unsubscribe();
    unsubscribeBoundary();
    setQueuedSendControl(null);
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function say(spawn: Spawn, text: string): void {
  spawn.writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: text, provider: 'claude', sessionId: CHAT }));
}

/** The agent ends its turn with background work alive: the runtime holds the process. */
function endTurnHeld(fixture: Fixture, text: string, tasks: Runtime['tasks']): void {
  const spawn = fixture.spawns.at(-1)!;
  say(spawn, text);
  fixture.runtime.tasks = tasks;
  fixture.runtime.accepting = true;
  spawn.writer.send(phaseFrame(tasks.some((task) => task.kind === 'agent') ? 'waiting_helpers' : 'parked', tasks));
}

/** The held process ends: the input was released and the CLI exited. */
function endRun(fixture: Fixture, exitCode = 0): void {
  const spawn = fixture.spawns.at(-1)!;
  fixture.runtime.accepting = false;
  fixture.runtime.tasks = [];
  spawn.writer.send(createCompleteMessage({ provider: 'claude', sessionId: CHAT, exitCode }));
  spawn.finish();
}

class FakeSocket extends EventEmitter {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  async deliver(payload: Record<string, unknown>): Promise<void> {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
    await settle();
  }
}

function connect(userId: number, role: string, dependencies: Fixture['dependencies']): FakeSocket {
  const socket = new FakeSocket();
  handleChatConnection(socket as never, { user: { id: userId, role } } as never, dependencies);
  return socket;
}

test('only a chat a person started is held: socket and queue runs get holdBackground; threads, the relay and ideas do not; the mod switch, a zero ceiling and a fenced teammate turn it off', async () => {
  await withWorld(async (fixture) => {
    const { dima, slavik, spawns, control, dependencies, jails, holdMs } = fixture;
    const finishLast = async () => { endRun(fixture); await settle(); };

    const tab = connect(dima, 'admin', dependencies);
    // A client cannot claim (or refuse) the hold itself.
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Собери', options: { holdBackground: false } });
    assert.equal(spawns.at(-1)!.options.holdBackground, true, 'a message from the composer');
    await finishLast();

    assert.deepEqual(control.send({ sessionId: CHAT, userId: dima, content: 'Из очереди', options: {}, images: [] }), { started: true });
    assert.equal(spawns.at(-1)!.options.holdBackground, true, 'a message from the server queue');
    await finishLast();

    const threads = createThreadRunControl(dependencies as Parameters<typeof createThreadRunControl>[0]);
    assert.equal(threads.start({ sessionId: CHAT, userId: dima, parentSessionId: CHAT, content: 'Треды готовы', options: { holdBackground: true } }), true);
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'a thread run');
    await finishLast();

    const relay = createAutoRelayRunControl(dependencies as Parameters<typeof createAutoRelayRunControl>[0]);
    assert.equal(relay.start({ sessionId: CHAT, userId: dima, parentSessionId: CHAT, content: 'Перенос', options: {} }), true);
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'a relay run');
    await finishLast();

    const ideas = createIdeaRunControl(dependencies as Parameters<typeof createIdeaRunControl>[0]);
    assert.equal(ideas.start({ sessionId: CHAT, userId: dima, content: 'Сделай идею' }), true);
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'an approved idea');
    await finishLast();

    // The ceiling is 0: the hold is switched off for everyone.
    holdMs.value = 0;
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Ещё', options: { holdBackground: true } });
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'NEO3_CLAUDE_BACKGROUND_HOLD_MS=0');
    await finishLast();
    holdMs.value = 7_200_000;

    // «Фон доживает до конца» switched off in the settings — no restart needed.
    uiPreferencesDb.updateUiPreferences(dima, { modBackgroundHold: false });
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Ещё', options: { holdBackground: true } });
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'the mod is off');
    await finishLast();
    uiPreferencesDb.updateUiPreferences(dima, { modBackgroundHold: true });
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Ещё', options: {} });
    assert.equal(spawns.at(-1)!.options.holdBackground, true, 'the mod is on again');
    await finishLast();

    // A teammate's process is fenced to what its first message needed: not held.
    jails.set(slavik, { root: '/workspace/hold-run' });
    const teammateTab = connect(slavik, 'user', dependencies);
    await teammateTab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'От Славика', options: {} });
    assert.equal(spawns.at(-1)!.options.holdBackground, undefined, 'a fenced teammate');
  });
});

test('phase frames reach the chat\'s tab; parked settles the status like a turn end while the run stays live; «ждёт помощников» keeps «работает»', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns } = fixture;
    const changes: string[] = [];
    const stop = sessionAttention.onChange((change) => { changes.push(change.state); });
    try {
      const tab = connect(dima, 'admin', dependencies);
      await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });

      endTurnHeld(fixture, 'Запустил помощника и сборку, жду.', [BASH, AGENT]);
      await settle();
      const waiting = tab.frames.find((frame) => frame.kind === 'run_phase')!;
      assert.equal(waiting.phase, 'waiting_helpers');
      assert.deepEqual(waiting.background, { agents: 1, shells: 1 });
      assert.equal(waiting.sessionId, CHAT);
      assert.equal(typeof waiting.seq, 'number');
      assert.ok(!Number.isNaN(Date.parse(String(waiting.since))) && !Number.isNaN(Date.parse(String(waiting.holdUntil))));
      assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working', 'helpers still work: the chat works');
      assert.equal(chatRunRegistry.runPhase(CHAT), 'waiting_helpers');

      // The helper is done, the agent took a turn and ended it with only the command alive.
      spawns[0].writer.send(phaseFrame('running', [BASH]));
      endTurnHeld(fixture, 'Помощник закончил. Сборка ещё идёт — вернусь, когда закончится.', [BASH]);
      await settle();
      assert.equal(sessionAttentionDb.get(CHAT)?.state, 'done', '«готово» comes when the answer is ready');
      assert.equal(chatRunRegistry.isProcessing(CHAT), true, 'the run is alive');
      assert.equal(chatRunRegistry.runPhase(CHAT), 'parked');
      assert.deepEqual(tab.frames.filter((frame) => frame.kind === 'run_phase').map((frame) => frame.phase), ['waiting_helpers', 'running', 'parked']);

      // The background finished: the agent wakes up by itself and asks a question this time.
      spawns[0].writer.send(phaseFrame('running', []));
      await settle();
      assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working', 'a turn nobody asked for is still «работает»');
      endTurnHeld(fixture, 'Сборка упала на тестах. Чинить или откатить?', [BASH]);
      await settle();
      assert.equal(sessionAttentionDb.get(CHAT)?.state, 'waiting');
      assert.equal(sessionAttentionDb.get(CHAT)?.reason, 'text_question');

      // A tab opened now replays the phases and knows the run is live.
      const late = connect(dima, 'admin', dependencies);
      await late.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: CHAT, lastSeq: 0 }] });
      assert.equal(late.frames.find((frame) => frame.kind === 'chat_subscribed')?.isProcessing, true);
      assert.equal(late.frames.filter((frame) => frame.kind === 'run_phase').at(-1)?.phase, 'parked');

      // The process ends with nothing new: the status was settled when the turn parked.
      const before = changes.length;
      endRun(fixture);
      await settle();
      assert.equal(sessionAttentionDb.get(CHAT)?.state, 'waiting');
      assert.equal(changes.length, before, 'the end of a parked run is not news a second time');
      assert.deepEqual(changes, ['working', 'done', 'working', 'waiting']);
    } finally {
      stop();
    }
  });
});

test('a message into a parked chat goes into the live process: no new run, the chat moves up and works, the sender\'s tab follows; mid-turn it is RUN_IN_PROGRESS; after the release it waits in the queue and is an ordinary new run when the process is gone — sent once', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns, runtime } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });

    // Mid-turn nothing is written into the process.
    const other = connect(dima, 'admin', dependencies);
    await other.deliver({ type: 'chat.send', sessionId: CHAT, content: 'посреди хода', options: {} });
    assert.equal(other.frames.find((frame) => frame.kind === 'protocol_error')?.code, 'RUN_IN_PROGRESS');
    assert.equal(runtime.taken.length, 0);

    endTurnHeld(fixture, 'Сборка идёт в фоне.', [BASH]);
    await settle();
    const promptedAt = sessionsDb.getSessionById(CHAT)?.last_prompt_at;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const phone = connect(dima, 'admin', dependencies);
    await phone.deliver({
      type: 'chat.send',
      sessionId: CHAT,
      content: 'А пока покажи лог',
      options: { images: [{ path: 'shot.png', mimeType: 'image/png' }] },
    });
    assert.equal(phone.frames.some((frame) => frame.kind === 'protocol_error'), false);
    assert.equal(spawns.length, 1, 'no second process: the background lives on');
    assert.equal(runtime.taken.length, 1);
    assert.match(runtime.taken[0].command, /^А пока покажи лог/);
    assert.deepEqual((runtime.taken[0].images as Array<{ path: string }>).map((image) => image.path), ['shot.png']);
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working');
    assert.ok(Date.parse(String(sessionsDb.getSessionById(CHAT)?.last_prompt_at)) > Date.parse(String(promptedAt)), '«Новые / Недавние» moved');
    assert.equal(chatRunRegistry.runPhase(CHAT), 'running');

    // The tab that sent it now follows the run.
    say(spawns[0], 'Вот лог.');
    assert.equal(phone.frames.at(-1)?.content, 'Вот лог.');
    assert.equal(tab.frames.at(-1)?.content === 'Вот лог.', false);

    // Runs the server starts for the user (an approved idea, «Треды готовы») take the same road.
    runtime.accepting = true;
    spawns[0].writer.send(phaseFrame('parked', [BASH]));
    const ideas = createIdeaRunControl(dependencies as Parameters<typeof createIdeaRunControl>[0]);
    assert.equal(ideas.start({ sessionId: CHAT, userId: dima, content: 'Сделай идею' }), true);
    assert.equal(runtime.taken.length, 2);
    runtime.accepting = true;
    spawns[0].writer.send(phaseFrame('parked', [BASH]));
    const threads = createThreadRunControl(dependencies as Parameters<typeof createThreadRunControl>[0]);
    assert.equal(threads.start({ sessionId: CHAT, userId: dima, parentSessionId: CHAT, content: 'Треды готовы', options: {} }), true);
    assert.equal(runtime.taken.length, 3);
    assert.equal(spawns.length, 1);

    // The input is released (the process is on its way out): the message is
    // not taken — and not lost: the sender cleared the field and drew the
    // bubble, so the server keeps it…
    runtime.accepting = false;
    spawns[0].writer.send(phaseFrame('parked', [BASH]));
    runtime.accepting = false;
    await phone.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Последнее', options: {} });
    assert.equal(phone.frames.some((frame) => frame.kind === 'protocol_error'), false, 'no refusal for a message the tab already shows as sent');
    assert.equal(runtime.taken.length, 3);
    assert.equal(spawns.length, 1);
    assert.equal(queuedMessagesService.get(CHAT)?.content, 'Последнее');
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, null);

    // …and once the run is over it is an ordinary new run, without anyone sending it again.
    endRun(fixture);
    await settle();
    assert.equal(spawns.length, 2);
    assert.match(spawns[1].command, /^Последнее/);
    assert.equal(runtime.taken.length, 3, 'delivered once, by one path');
    assert.equal(queuedMessagesService.get(CHAT), null);
  });
});

test('a message sent «между ходами» is never lost when the live process cannot take it: no refusal, it waits in the server queue and leaves with the end of that turn — also when the chat «ждёт тебя», without a second bubble', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns, runtime } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });

    // The agent parked with a question; the input was released a moment ago,
    // `complete` has not come yet — the tab still shows «между ходами».
    endTurnHeld(fixture, 'Сборка упала на тестах. Чинить или откатить?', [BASH]);
    await settle();
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'waiting');
    runtime.accepting = false;
    const phone = connect(dima, 'admin', dependencies);
    await phone.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Чини', options: { model: 'opus[1m]', permissionMode: 'acceptEdits' } });
    assert.equal(phone.frames.some((frame) => frame.kind === 'protocol_error'), false);
    assert.equal(spawns.length, 1);
    assert.equal(runtime.taken.length, 0);
    assert.equal(queuedMessagesService.get(CHAT)?.content, 'Чини', 'kept on the server');
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, null, 'it is the answer: not held as «агент ждёт твоего ответа»');

    endRun(fixture);
    await settle();
    assert.equal(spawns.length, 2, 'left by itself with `complete`');
    assert.match(spawns[1].command, /^Чини/);
    assert.equal(spawns[1].options.permissionMode, 'acceptEdits');
    assert.equal(spawns[1].options.model, 'opus[1m]');
    assert.equal(queuedMessagesService.get(CHAT), null);
    assert.equal(phone.frames.some((frame) => frame.kind === 'text' && frame.role === 'user'), false, 'the sender drew its bubble itself');
    // The tab that sent it follows the run that took it.
    say(spawns[1], 'Чиню.');
    assert.equal(phone.frames.at(-1)?.content, 'Чиню.');

    // The agent woke up by itself and the `running` frame did not reach the tab: the same road.
    endTurnHeld(fixture, 'Починил, прогон тестов в фоне.', [BASH]);
    await settle();
    runtime.accepting = false;
    spawns[1].writer.send(phaseFrame('running', [BASH]));
    await phone.deliver({ type: 'chat.send', sessionId: CHAT, content: 'И выкати', options: {} });
    assert.equal(phone.frames.some((frame) => frame.kind === 'protocol_error'), false);
    assert.equal(runtime.taken.length, 0, 'nothing is glued into a running turn');
    assert.equal(queuedMessagesService.get(CHAT)?.content, 'И выкати');

    endTurnHeld(fixture, 'Тесты прошли.', [BASH]);
    await settle();
    assert.equal(runtime.taken.length, 1, 'the turn ended: it went into the live process');
    assert.match(runtime.taken[0].command, /^И выкати/);
    assert.equal(spawns.length, 2);
    assert.equal(queuedMessagesService.get(CHAT), null);
  });
});

test('plan after bypass edits nothing: a message with other engine settings is not written into the live process — the hold ends and it starts an ordinary run with its own settings, once', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns, runtime } = fixture;
    const bypass = { model: 'opus[1m]', effort: 'high', permissionMode: 'bypassPermissions' };
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: bypass });
    runtime.processMode = 'bypassPermissions';
    endTurnHeld(fixture, 'Сборка идёт в фоне.', [BASH]);
    await settle();

    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Сначала покажи план', options: { ...bypass, permissionMode: 'plan' } });
    assert.equal(runtime.taken.length, 0, 'the process with full access never saw the «план» message');
    assert.deepEqual(runtime.released, [CHAT], 'the hold ends');
    assert.equal(tab.frames.some((frame) => frame.kind === 'protocol_error'), false);
    assert.equal(spawns.length, 1);

    endRun(fixture);
    await settle();
    assert.equal(spawns.length, 2);
    assert.match(spawns[1].command, /^Сначала покажи план/);
    assert.equal(spawns[1].options.permissionMode, 'plan', 'the new process runs in the mode of the message');
    assert.equal(spawns[1].options.model, 'opus[1m]');
    assert.equal(spawns[1].options.effort, 'high');
    assert.equal(queuedMessagesService.get(CHAT), null, 'sent once');

    // The same settings: the live process takes the message, with the settings named.
    runtime.processMode = 'plan';
    endTurnHeld(fixture, 'План готов.', [BASH]);
    await settle();
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Уточни шаг 2', options: { ...bypass, permissionMode: 'plan' } });
    assert.equal(spawns.length, 2);
    assert.equal(runtime.taken.length, 1);
    assert.deepEqual(
      { model: runtime.taken[0].model, effort: runtime.taken[0].effort, permissionMode: runtime.taken[0].permissionMode },
      { model: 'opus[1m]', effort: 'high', permissionMode: 'plan' },
    );
  });
});

test('Claude\'s 5-hour limit and the queue: a blocked limit starts no run and keeps the message in its card with the reason; «отправить» runs it anyway; a live process is not asked', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns, runtime, guard } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Собери', options: {} });
    await queuedMessagesService.put(CHAT, dima, { content: 'Потом выкати', options: { model: 'opus[1m]' } });

    guard.blocked = true;
    guard.pct = 95;
    // The turn ends with a plain answer: «готово» is settled at once, from the text.
    say(spawns[0], 'Собрал.');
    endRun(fixture);
    await settle();
    assert.equal(spawns.length, 1, 'no run that the runtime would refuse a moment later');
    const held = queuedMessagesService.get(CHAT);
    assert.equal(held?.content, 'Потом выкати');
    assert.equal(held?.holdReason, 'error');
    assert.match(String(held?.lastError), /95% 5-часового лимита подписки/);
    assert.match(String(held?.lastError), /21:00 МСК/);
    assert.match(String(held?.lastError), /«Отправить»/);

    const now = await queuedMessagesService.sendNow(CHAT, dima);
    await settle();
    assert.equal(now.sent, true);
    assert.equal(spawns.length, 2);
    assert.match(spawns[1].command, /^Потом выкати/);
    assert.equal(spawns[1].options.usageGuardOverride, true, 'the runtime is told the user confirmed');

    // Between turns the message goes into the live process: no new run, no limit to ask.
    endTurnHeld(fixture, 'Выкатил, сборка в фоне.', [BASH]);
    await settle();
    const asked = guard.asked;
    const put = await queuedMessagesService.put(CHAT, dima, { content: 'Покажи лог' });
    assert.equal(put.sent, true);
    assert.equal(runtime.taken.length, 1);
    assert.equal(guard.asked, asked);
  });
});

test('the queue and a held run: a message queued mid-turn leaves when the turn parks «готово»; put and send-now between turns go into the live process without «Стоп»; the bubble reaches the subscribers', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, spawns, runtime, aborted } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });

    const queued = await queuedMessagesService.put(CHAT, dima, { content: 'Потом выкати', images: [{ path: 'a.png', mimeType: 'image/png' }] });
    assert.equal(queued.sent, false, 'a turn is going: the message waits');

    tab.frames.length = 0;
    endTurnHeld(fixture, 'Сборка идёт в фоне, вернусь сам.', [BASH]);
    await settle();
    assert.equal(spawns.length, 1, 'no new process');
    assert.equal(runtime.taken.length, 1, 'the queued message went into the live one');
    assert.match(runtime.taken[0].command, /^Потом выкати/);
    assert.equal(queuedMessagesService.get(CHAT), null);
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working');
    const bubble = tab.frames.find((frame) => frame.kind === 'text' && frame.role === 'user')!;
    assert.equal(bubble.content, 'Потом выкати');
    assert.match(String(bubble.id), /^local_queue_/);
    assert.deepEqual(bubble.images, [{ path: 'a.png', mimeType: 'image/png' }]);
    assert.equal(typeof bubble.seq, 'number');

    // «Ждёт помощников»: the status does not change, the queue still learns the turn is over.
    await queuedMessagesService.put(CHAT, dima, { content: 'И ещё проверь логи' });
    assert.equal(runtime.taken.length, 1);
    endTurnHeld(fixture, 'Выкатываю, помощник проверяет.', [BASH, AGENT]);
    await settle();
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working');
    assert.equal(runtime.taken.length, 2, 'sent without a status change');
    assert.match(runtime.taken[1].command, /^И ещё проверь логи/);

    // Between turns a put is sent at once…
    endTurnHeld(fixture, 'Логи чистые.', [BASH]);
    await settle();
    const put = await queuedMessagesService.put(CHAT, dima, { content: 'Сразу' });
    assert.deepEqual({ sent: put.sent, queued: put.queued }, { sent: true, queued: null });
    assert.equal(runtime.taken.length, 3);

    // …and «отправить сейчас» does not stop the run (that would kill the background).
    endTurnHeld(fixture, 'Сделал.', [BASH, AGENT]);
    await settle();
    runtime.accepting = false;
    await queuedMessagesService.put(CHAT, dima, { content: 'Сейчас' });
    assert.equal(queuedMessagesService.get(CHAT)?.content, 'Сейчас', 'the process did not take it: it stays queued');
    runtime.accepting = true;
    const now = await queuedMessagesService.sendNow(CHAT, dima);
    await settle();
    assert.equal(now.sent, true);
    assert.deepEqual(aborted, [], 'no «Стоп»');
    assert.equal(runtime.taken.length, 4);
    assert.equal(spawns.length, 1);
  });
});

test('«Стоп» on a parked chat: complete says what was killed, and the queued message is held «stopped» although the status did not change', async () => {
  await withWorld(async (fixture) => {
    const { dima, dependencies, runtime, aborted, control } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });
    endTurnHeld(fixture, 'Сборка и два монитора в фоне.', [BASH, { taskId: 'm1', kind: 'monitor' }]);
    await settle();
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'done');

    // A message that the process refuses for a moment stays queued, with no hold.
    runtime.accepting = false;
    await queuedMessagesService.put(CHAT, dima, { content: 'После сборки выкати' });
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, null);

    await tab.deliver({ type: 'chat.abort', sessionId: CHAT });
    const complete = tab.frames.find((frame) => frame.kind === 'complete')!;
    assert.equal(complete.aborted, true);
    assert.deepEqual(complete.killedBackground, { agents: 0, shells: 2 });
    assert.deepEqual(aborted, [CHAT]);
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'done', 'done → done: the status is silent');
    assert.equal(control.lastRunStopped(CHAT), true);
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, 'stopped');

    // Nothing in the background: «Стоп» says nothing about it.
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Ещё раз', options: {} });
    runtime.tasks = [];
    tab.frames.length = 0;
    await tab.deliver({ type: 'chat.abort', sessionId: CHAT });
    assert.equal('killedBackground' in tab.frames.find((frame) => frame.kind === 'complete')!, false);
  });
});

test('a fenced teammate\'s message is never written into an admin\'s process: the hold ends, and the message starts his own fenced run when that process is gone', async () => {
  await withWorld(async (fixture) => {
    const { dima, slavik, dependencies, spawns, runtime, jails } = fixture;
    const tab = connect(dima, 'admin', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Запусти сборку', options: {} });
    endTurnHeld(fixture, 'Сборка идёт в фоне.', [BASH]);
    await settle();

    jails.set(slavik, { root: '/workspace/hold-run' });
    const teammateTab = connect(slavik, 'user', dependencies);
    await teammateTab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'От Славика', options: {} });
    assert.equal(teammateTab.frames.some((frame) => frame.kind === 'protocol_error'), false, 'his tab already shows the message as sent');
    assert.equal(runtime.taken.length, 0, 'not a byte of it reached the unfenced process');
    assert.deepEqual(runtime.released, [CHAT], 'the hold is released for him');
    assert.equal(queuedMessagesService.get(CHAT)?.content, 'От Славика');

    endRun(fixture);
    await settle();
    assert.equal(spawns.length, 2, 'sent by the server, nobody had to send it again');
    assert.match(spawns[1].command, /^От Славика/);
    assert.deepEqual((spawns[1].options.jail as { root: string }).root, '/workspace/hold-run');
    assert.equal(queuedMessagesService.get(CHAT), null);
  });
});
