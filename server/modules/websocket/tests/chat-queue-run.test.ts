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
  userDb,
  userProjectAccessDb,
} from '@/modules/database/index.js';
import {
  queuedAttentionListener,
  queuedMessagesService,
  setQueuedSendControl,
} from '@/modules/queued-messages/index.js';
import { sessionAttention } from '@/modules/session-attention/index.js';
// Loaded up front: the queue reaches its frame through a lazy import of this
// barrel, and the first load must not land in the middle of a later test.
import { notifyQueuedMessageChanged } from '@/modules/websocket/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  createQueuedSendControl,
  createThreadRunControl,
  handleChatConnection,
} from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import { setChatEventWriter } from '@/shared/chat-event-log.js';
import { JAIL_DENIED_MESSAGE } from '@/shared/user-jail.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

// The queue end to end on the server: real run registry, real chat status
// («Ждут тебя»), the production wiring of the queue — only the engines are
// fakes. No websocket is needed for a queued message to leave.

type Writer = { send(data: unknown): void };
type Spawn = { command: string; options: Record<string, unknown>; writer: Writer; finish(): void };
type Fixture = {
  dima: number;
  slavik: number;
  guest: number;
  spawns: Spawn[];
  aborted: string[];
  dependencies: Parameters<typeof createQueuedSendControl>[0];
  control: ReturnType<typeof createQueuedSendControl>;
  /** What the fake jail answers (default: no jail). */
  jail: { value: unknown };
};

/** One Claude chat; its app id equals the engine's id, as for every chat found on disk. */
const CHAT = 'claude-native-1';
const SECRET_TEXT = 'Перезапусти бота Samruk и проверь логи';

assert.equal(typeof notifyQueuedMessageChanged, 'function');

/** Lets deferred work (the queue reacts to a status change on the next tick) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Waits for something that arrives «soon» rather than «within N ticks»: the
 * queue's frame leaves after a lazy module load, and how many ticks that takes
 * depends on the Node version and its loader (Node 22 on Linux needed more
 * than `settle()` gives — the test was red there and green on Node 24).
 */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withWorld(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'chat-queue-run-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();

  const spawns: Spawn[] = [];
  const aborted: string[] = [];
  const jail = { value: null as unknown };
  // An engine that runs until the test ends its turn.
  const spawn = (command: string, options: Record<string, unknown>, writer: Writer) => {
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    spawns.push({ command, options, writer, finish });
    return done;
  };
  const dependencies = {
    userJailFor: () => jail.value,
    spawnFns: { claude: spawn },
    abortFns: {
      claude: async (providerSessionId: string) => { aborted.push(providerSessionId); return true; },
    },
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    isModOn: () => true,
  } as unknown as Parameters<typeof createQueuedSendControl>[0];
  const control = createQueuedSendControl(dependencies);
  setQueuedSendControl(control);
  const unsubscribe = sessionAttention.onChange(queuedAttentionListener());

  try {
    const dima = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
    const slavik = Number(userDb.createUserWithRole('slavik', 'x', 'user').id);
    const guest = Number(userDb.createUserWithRole('guest', 'x', 'user').id);
    const project = projectsDb.createProjectPath('/workspace/queue-run').project!;
    userProjectAccessDb.grantAccess(slavik, project.project_id, dima);
    assert.equal(sessionsDb.createSession(CHAT, 'claude', project.project_path, 'Выкатка'), CHAT);
    await runTest({ dima, slavik, guest, spawns, aborted, dependencies, control, jail });
  } finally {
    await settle();
    unsubscribe();
    setQueuedSendControl(null);
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

/** The engine says its last words and ends the turn. */
function endTurn(spawn: Spawn, text: string, exitCode = 0): void {
  spawn.writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: text, provider: 'claude', sessionId: CHAT }));
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

test('a queued send is an ordinary run of the user who queued: text, options and pictures reach the engine, the chat moves up and «работает»', async () => {
  await withWorld(async ({ dima, control, spawns }) => {
    assert.equal(sessionsDb.getSessionById(CHAT)?.last_prompt_at ?? null, null);

    const outcome = control.send({
      sessionId: CHAT,
      userId: dima,
      content: 'Теперь выкати',
      options: { model: 'opus[1m]', effort: 'high', permissionMode: 'bypassPermissions' },
      images: [{ path: 'shot-1.png', name: 'экран.png', mimeType: 'image/png' }],
    });

    assert.deepEqual(outcome, { started: true });
    assert.equal(chatRunRegistry.isProcessing(CHAT), true);
    assert.equal(control.isRunLive(CHAT), true);
    assert.equal(spawns.length, 1);
    assert.match(spawns[0].command, /^Теперь выкати/);
    assert.equal(spawns[0].options.model, 'opus[1m]');
    assert.equal(spawns[0].options.effort, 'high');
    assert.equal(spawns[0].options.permissionMode, 'bypassPermissions');
    assert.deepEqual((spawns[0].options.images as Array<{ path: string }>).map((image) => image.path), ['shot-1.png']);
    assert.equal(spawns[0].options.resume, true);

    // The same bookkeeping as a message sent from a tab.
    assert.ok(!Number.isNaN(Date.parse(String(sessionsDb.getSessionById(CHAT)?.last_prompt_at))), '«Новые / Недавние» moved');
    const status = sessionAttentionDb.get(CHAT);
    assert.equal(status?.state, 'working');
    assert.equal(status?.user_id, dima);
  });
});

test('queue access is the user\'s access now: no access, no user, a busy chat and a jail refusal are told apart', async () => {
  await withWorld(async ({ dima, slavik, guest, control, spawns, jail }) => {
    const message = { sessionId: CHAT, content: 'x', options: {}, images: [] };

    const stranger = control.send({ ...message, userId: guest });
    assert.equal(stranger.started, false);
    assert.deepEqual([stranger.started === false && stranger.busy, stranger.started === false && stranger.error], [false, 'Нет доступа к проекту этого чата']);

    const nobody = control.send({ ...message, userId: null });
    assert.equal(nobody.started === false && nobody.busy, false);

    const missing = control.send({ ...message, sessionId: 'no-such-chat', userId: dima });
    assert.equal(missing.started === false && missing.error, 'Чат не найден');

    // A teammate whose chat cannot be fenced: the jail's own words reach the card.
    jail.value = 'deny';
    const fenced = control.send({ ...message, userId: slavik });
    assert.deepEqual(fenced, { started: false, busy: false, error: JAIL_DENIED_MESSAGE });
    jail.value = null;
    assert.equal(spawns.length, 0);
    assert.equal(chatRunRegistry.isProcessing(CHAT), false);

    assert.deepEqual(control.send({ ...message, userId: slavik }), { started: true });
    const busy = control.send({ ...message, userId: slavik });
    assert.equal(busy.started === false && busy.busy, true);
    assert.equal(spawns.length, 1);
  });
});

test('chat.send into a busy chat is still refused with RUN_IN_PROGRESS — the queue is its own explicit request', async () => {
  await withWorld(async ({ dima, control, dependencies, spawns }) => {
    control.send({ sessionId: CHAT, userId: dima, content: 'первое', options: {}, images: [] });
    const socket = connect(dima, 'admin', dependencies);
    await socket.deliver({ type: 'chat.send', sessionId: CHAT, content: 'второе', options: {} });

    const refusal = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.equal(refusal?.code, 'RUN_IN_PROGRESS');
    assert.equal(spawns.length, 1);
    assert.equal(queuedMessagesService.get(CHAT), null, 'a refused chat.send is not queued behind the user\'s back');

    // Threads rely on the same refusal.
    const threads = createThreadRunControl(dependencies as Parameters<typeof createThreadRunControl>[0]);
    assert.equal(threads.start({ sessionId: CHAT, userId: dima, parentSessionId: CHAT, content: 'Треды готовы', options: {} }), false);
  });
});

test('the turn ended, nobody is connected: the server sends the queued message itself and the agent starts on it', async () => {
  await withWorld(async ({ dima, control, spawns }) => {
    control.send({ sessionId: CHAT, userId: dima, content: 'Собери отчёт', options: { model: 'opus[1m]' }, images: [] });
    const promptedAt = sessionsDb.getSessionById(CHAT)?.last_prompt_at;

    const put = await queuedMessagesService.put(CHAT, dima, {
      content: SECRET_TEXT,
      options: { model: 'sonnet[1m]', permissionMode: 'default' },
      images: [{ path: 'log.png', mimeType: 'image/png' }],
    });
    assert.equal(put.sent, false);
    assert.equal(connectedClients.size, 0, 'no tab is open');

    await new Promise((resolve) => setTimeout(resolve, 5));
    endTurn(spawns[0], 'Отчёт готов.');
    await settle();

    assert.equal(spawns.length, 2, 'the server started the next run by itself');
    assert.match(spawns[1].command, new RegExp(`^${SECRET_TEXT}`));
    assert.equal(spawns[1].options.model, 'sonnet[1m]');
    assert.deepEqual((spawns[1].options.images as Array<{ path: string }>).map((image) => image.path), ['log.png']);
    assert.equal(chatRunRegistry.isProcessing(CHAT), true);
    assert.equal(queuedMessagesService.get(CHAT), null, 'the queue is empty');
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'working');
    assert.ok(Date.parse(String(sessionsDb.getSessionById(CHAT)?.last_prompt_at)) > Date.parse(String(promptedAt)), 'a queued message is the user\'s message: the chat moved up again');

    // The new run's own end sends nothing more.
    endTurn(spawns[1], 'Перезапустил.');
    await settle();
    assert.equal(spawns.length, 2);
  });
});

test('the agent ended with a question, an engine error, or «Стоп»: the message stays queued with its reason', async () => {
  await withWorld(async ({ dima, control, spawns, aborted }) => {
    control.send({ sessionId: CHAT, userId: dima, content: 'Начни', options: {}, images: [] });
    await queuedMessagesService.put(CHAT, dima, { content: SECRET_TEXT });
    endTurn(spawns[0], 'Нашёл два пути. Делаем первый или второй?');
    await settle();
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'waiting');
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, 'question');
    assert.equal(spawns.length, 1, 'nothing is sent while the chat «ждёт тебя»');

    // The user answers from a tab; that run crashes.
    control.send({ sessionId: CHAT, userId: dima, content: 'Первый', options: {}, images: [] });
    await settle();
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, null, 'the question is answered: the message goes with the turn end again');
    endTurn(spawns[1], 'Падаю', 1);
    await settle();
    assert.equal(sessionAttentionDb.get(CHAT)?.state, 'failed');
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, 'failed');
    assert.equal(spawns.length, 2);

    // A fresh message in the next turn, then «Стоп».
    control.send({ sessionId: CHAT, userId: dima, content: 'Ещё раз', options: {}, images: [] });
    await queuedMessagesService.put(CHAT, dima, { content: 'после стопа не уходи' });
    assert.equal(await control.abortRun(CHAT, dima), true);
    await settle();
    assert.deepEqual(aborted, ['claude-native-1']);
    assert.equal(control.lastRunStopped(CHAT), true);
    assert.equal(queuedMessagesService.get(CHAT)?.holdReason, 'stopped');
    assert.equal(spawns.length, 3, 'a stopped turn does not release the queue');
  });
});

test('send-now: the server stops the live turn and sends after the stop, with no tab involved', async () => {
  await withWorld(async ({ dima, control, spawns, aborted }) => {
    control.send({ sessionId: CHAT, userId: dima, content: 'Долгая задача', options: {}, images: [] });
    await queuedMessagesService.put(CHAT, dima, { content: 'Стоп, сначала вот это', options: { model: 'opus[1m]' } });

    const result = await queuedMessagesService.sendNow(CHAT, dima);
    await settle();

    assert.equal(result.sent, true);
    assert.deepEqual(aborted, ['claude-native-1']);
    assert.equal(spawns.length, 2);
    assert.match(spawns[1].command, /^Стоп, сначала вот это/);
    assert.equal(chatRunRegistry.isProcessing(CHAT), true);
    assert.equal(queuedMessagesService.get(CHAT), null);
  });
});

test('the tab that watched the turn keeps watching the queued one and gets the user\'s bubble; a tab without access gets nothing', async () => {
  await withWorld(async ({ dima, slavik, guest, control, dependencies, spawns }) => {
    const tab = connect(slavik, 'user', dependencies);
    const strangerTab = connect(guest, 'user', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Начни', options: {} });
    assert.equal(spawns.length, 1);

    await queuedMessagesService.put(CHAT, slavik, { content: 'А потом это', images: [{ path: 'a.png', mimeType: 'image/png' }] });
    await settle();
    await waitFor(() => tab.frames.some((frame) => frame.kind === 'queued_message_changed'));
    // Content-free frame, only for sockets that may see the project.
    assert.deepEqual(tab.frames.filter((frame) => frame.kind === 'queued_message_changed'), [{ kind: 'queued_message_changed', sessionId: CHAT }]);
    assert.equal(strangerTab.frames.some((frame) => frame.kind === 'queued_message_changed'), false);

    tab.frames.length = 0;
    endTurn(spawns[0], 'Сделал.');
    await settle();
    assert.equal(spawns.length, 2);
    spawns[1].writer.send(createNormalizedMessage({ kind: 'text', role: 'assistant', content: 'Делаю это', provider: 'claude', sessionId: CHAT }));

    const afterComplete = tab.frames.slice(tab.frames.findIndex((frame) => frame.kind === 'complete') + 1)
      .filter((frame) => frame.kind === 'text');
    assert.equal(afterComplete.length, 2);
    const [bubble, answer] = afterComplete;
    assert.equal(bubble.role, 'user');
    assert.equal(bubble.content, 'А потом это');
    assert.match(String(bubble.id), /^local_queue_/);
    assert.equal(bubble.sessionId, CHAT);
    assert.equal(bubble.seq, 1);
    assert.deepEqual(bubble.images, [{ path: 'a.png', mimeType: 'image/png' }]);
    assert.equal(answer.content, 'Делаю это');
    assert.equal(answer.seq, 2);
    await waitFor(() => tab.frames.some((frame) => frame.kind === 'queued_message_changed'));
    await settle();
    assert.equal(tab.frames.filter((frame) => frame.kind === 'queued_message_changed').length, 1, 'the queue emptied: one more frame');

    // A tab that subscribes later replays the same bubble.
    const late = connect(slavik, 'user', dependencies);
    await late.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: CHAT, lastSeq: 0 }] });
    assert.equal(late.frames.find((frame) => frame.kind === 'text' && frame.role === 'user')?.content, 'А потом это');

    assert.equal(strangerTab.frames.some((frame) => frame.kind === 'text'), false);
  });
});

test('a watcher who lost access to the project is not carried over to the queued run', async () => {
  await withWorld(async ({ dima, slavik, control, dependencies, spawns }) => {
    const tab = connect(slavik, 'user', dependencies);
    await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: 'Начни', options: {} });
    await queuedMessagesService.put(CHAT, dima, { content: 'Уже без Славика' });

    const project = projectsDb.getProjectPath('/workspace/queue-run')!;
    userProjectAccessDb.revokeAccess(slavik, project.project_id);
    tab.frames.length = 0;
    endTurn(spawns[0], 'Сделал.');
    await settle();

    assert.equal(spawns.length, 2);
    assert.equal(control.isRunLive(CHAT), true);
    assert.equal(tab.frames.some((frame) => frame.kind === 'text' && frame.role === 'user'), false);
  });
});

test('the journal has timed lines for subscribe, send, abort, run start and end, queue put and send — and never the message text', async () => {
  await withWorld(async ({ dima, dependencies, spawns }) => {
    const lines: string[] = [];
    const restore = setChatEventWriter((line) => { lines.push(line); });
    try {
      const tab = connect(dima, 'admin', dependencies);
      await tab.deliver({ type: 'chat.subscribe', sessions: [{ sessionId: CHAT, lastSeq: 0 }] });
      await tab.deliver({ type: 'chat.send', sessionId: CHAT, content: SECRET_TEXT, options: {} });
      await queuedMessagesService.put(CHAT, dima, { content: SECRET_TEXT });
      endTurn(spawns[0], 'Готово.');
      await settle();
      await tab.deliver({ type: 'chat.abort', sessionId: CHAT });
    } finally {
      restore();
    }

    const events = lines.map((line) => line.split(' ')[2]);
    assert.deepEqual(events, [
      'subscribe',
      'run_start', 'send',
      'queue_put',
      'run_complete',
      'run_start', 'send', 'queue_send',
      'abort', 'run_complete',
    ]);
    for (const line of lines) {
      assert.match(line, /^\[chat\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z [a-z_]+ session=claude-native-1 user=\d+( [A-Za-z]+=[A-Za-z0-9_.:-]+)*$/);
      assert.match(line, new RegExp(` user=${dima}( |$)`));
      assert.doesNotMatch(line, /Перезапусти|Samruk|Готово/);
    }
    assert.match(lines[0], / processing=false lastSeq=0$/);
    assert.match(lines[2], / access=socket started=true$/);
    assert.match(lines[4], / exitCode=0 aborted=false /);
    assert.match(lines[6], / access=queue started=true$/);
    assert.match(lines[8], / stopped=true$/);
    assert.match(lines[9], / aborted=true /);
  });
});
