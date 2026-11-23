import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { closeConnection, initializeDatabase, userDb } from './modules/database/index.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { setChatEventWriter } from './shared/chat-event-log.js';

// «Фон доживает до конца» at the Claude runtime, without Claude: the SDK is a
// fake CLI that reads the held-open input like the real one (it starts a turn
// for every user message and exits when its stdin closes) and emits the event
// sequences recorded live (notes.md §9, SDK 0.3.220 / CLI 2.1.321).

// The grace window before a release is read once, at module load.
process.env.CLAUDE_RELEASE_GRACE_MS = '25';
const GRACE_MS = 25;
const {
  abortClaudeSDKSession,
  queryClaudeSDK,
  releaseHeldClaudeRun,
  resolveToolApproval,
  sendToHeldClaudeRun,
} = await import('./claude-sdk.js');

// The runtime reads the user's mod switches and writes run outcomes: a database of its own.
let databaseDirectory;
let userId;
let previousDatabasePath;
before(async () => {
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'claude-hold-'));
  previousDatabasePath = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(databaseDirectory, 'auth.db');
  await initializeDatabase();
  userId = Number(userDb.createUserWithRole('dima', 'x', 'admin').id);
});
after(async () => {
  closeConnection();
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousDatabasePath;
  await rm(databaseDirectory, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) assert.fail(`timed out waiting for: ${label}`);
    await sleep(5);
  }
}

let sessionCounter = 0;

/** A CLI process behind the SDK: `emit` is its stdout, `inputs` what reached its stdin. */
function createFakeCli() {
  sessionCounter += 1;
  const sessionId = `claude-hold-${sessionCounter}`;
  const out = [];
  const inputs = [];
  let wake = null;
  let exited = false;
  const cli = {
    sessionId,
    inputs,
    stdinClosed: false,
    interrupts: 0,
    emit(...messages) {
      for (const message of messages) out.push({ session_id: sessionId, ...message });
      wake?.();
    },
    query({ prompt, options }) {
      // What the process was started with (its permission callback included).
      cli.options = options;
      const exit = () => { exited = true; wake?.(); };
      options.abortController?.signal.addEventListener('abort', exit, { once: true });
      void (async () => {
        for await (const message of prompt) inputs.push(message);
        // stdin closed: an idle CLI exits (§9, scenario 3).
        cli.stdinClosed = true;
        exit();
      })();
      return {
        interrupt: async () => { cli.interrupts += 1; },
        stopTask: async () => {},
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (out.length > 0) { yield out.shift(); continue; }
            if (exited) return;
            await new Promise((resolve) => { wake = resolve; });
            wake = null;
          }
        },
      };
    },
  };
  return cli;
}

const running = { type: 'system', subtype: 'session_state_changed', state: 'running' };
const idle = { type: 'system', subtype: 'session_state_changed', state: 'idle' };
const init = { type: 'system', subtype: 'init', tools: [] };
const result = { type: 'result', subtype: 'success', num_turns: 1 };
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const background = (...tasks) => ({
  type: 'system',
  subtype: 'background_tasks_changed',
  tasks: tasks.map(([task_id, task_type]) => ({ task_id, task_type, description: task_id })),
});
const BASH = ['b1', 'local_bash'];
const AGENT = ['a1', 'local_agent'];

function createWriter() {
  const frames = [];
  return {
    userId,
    frames,
    send(message) { frames.push(message); },
    setSessionId() {},
    kinds: () => frames.map((frame) => frame.kind),
    phases: () => frames.filter((frame) => frame.kind === 'run_phase'),
    texts: () => frames.filter((frame) => frame.kind === 'text').map((frame) => frame.content),
  };
}

/** Starts a run on a fake CLI; `done` settles when queryClaudeSDK returns. */
function startRun(t, options = {}) {
  t.mock.method(providerModelsService, 'getProviderModels', async () => ({ models: { DEFAULT: 'opus[1m]', OPTIONS: [] } }));
  t.mock.method(providerModelsService, 'resolveResumeModel', async () => 'opus[1m]');
  t.mock.method(providerModelsService, 'resolveResumeEffort', async () => undefined);
  const cli = createFakeCli();
  const writer = createWriter();
  let finished = false;
  const done = queryClaudeSDK(
    'запусти сборку в фоне',
    { usageGuardOverride: true, appSessionId: `app-${cli.sessionId}`, ...options },
    writer,
    { query: cli.query },
  ).finally(() => { finished = true; });
  // A failed assertion must not leave a held process behind (it would keep the test file alive).
  t.after(async () => { if (!finished) await abortClaudeSDKSession(cli.sessionId); });
  return { cli, writer, done, isFinished: () => finished };
}

/** The first turn of §9 scenario 1: a background command is started, the agent says «жду» and ends the turn. */
async function firstTurnLeavingBackground(cli, ...tasks) {
  await until(() => cli.inputs.length === 1, 'the first message reached the CLI');
  cli.emit(running, init, background(...tasks), say('жду'), result, idle);
}

function withHoldMs(t, value) {
  const previous = process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS;
  if (value === undefined) delete process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS;
  else process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS = String(value);
  t.after(() => {
    if (previous === undefined) delete process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS;
    else process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS = previous;
  });
}

function captureJournal(t) {
  const lines = [];
  t.after(setChatEventWriter((line) => { lines.push(line); }));
  return lines;
}

// Split from «a live background task does not hold the run after idle»: that
// stays true for every run that did not ask for the hold (threads, agents,
// the conveyor, the relay, schedules, the duet)…
test('without holdBackground a live background task does not hold the run after idle: the input is released and the run completes', async (t) => {
  withHoldMs(t, undefined);
  const { cli, writer, done } = startRun(t);
  await firstTurnLeavingBackground(cli, BASH);

  await done;
  assert.equal(cli.stdinClosed, true);
  assert.equal(writer.frames.at(-1).kind, 'complete');
  assert.equal(writer.frames.at(-1).exitCode, 0);
  assert.deepEqual(writer.phases(), [], 'no phase frames: nothing changed for such runs');
  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'поздно' }), false);
});

// …and is the opposite for a chat a person started.
test('with holdBackground a live background task holds the run after idle: stdin stays open, the chat is told it is parked', async (t) => {
  withHoldMs(t, 60_000);
  const { cli, writer, isFinished } = startRun(t, { holdBackground: true });
  const before = Date.now();
  await firstTurnLeavingBackground(cli, BASH);
  await until(() => writer.phases().length === 1, 'the parked frame');
  await sleep(GRACE_MS * 4);

  assert.equal(cli.stdinClosed, false, 'the input is not released while the background lives');
  assert.equal(isFinished(), false);
  assert.equal(writer.kinds().includes('complete'), false);

  const [parked] = writer.phases();
  assert.equal(parked.phase, 'parked');
  assert.equal(parked.provider, 'claude');
  assert.equal(parked.sessionId, cli.sessionId);
  assert.deepEqual(parked.background, { agents: 0, shells: 1 });
  const since = Date.parse(parked.since);
  assert.ok(since >= before && since <= Date.now(), 'since = when the turn ended');
  assert.equal(Date.parse(parked.holdUntil) - since, 60_000, 'holdUntil = the ceiling');
  assert.ok(writer.kinds().indexOf('run_phase') > writer.kinds().indexOf('text'), 'the phase follows the turn\'s last words');

  await abortClaudeSDKSession(cli.sessionId);
});

test('the end of the background wakes the held agent: a new turn runs without any user message, then the run completes', async (t) => {
  withHoldMs(t, 60_000);
  const journal = captureJournal(t);
  const { cli, writer, done } = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(cli, BASH);
  await until(() => writer.phases().length === 1, 'the parked frame');
  await sleep(GRACE_MS * 3);

  // §9 scenario 1, 45.5 s: the notification is its own turn.
  cli.emit(
    { type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed' },
    background(),
    running,
    init,
    say('Фоновая команда завершилась, продолжаю.'),
  );
  await until(() => writer.texts().length === 2, 'the new turn\'s text');
  assert.deepEqual(writer.phases().map((frame) => frame.phase), ['parked', 'running']);
  assert.equal(writer.phases()[1].holdUntil, undefined);
  assert.equal(cli.inputs.length, 1, 'nobody wrote to the agent — it woke up by itself');
  assert.equal(cli.stdinClosed, false);

  cli.emit(result, idle);
  await done;
  assert.equal(cli.stdinClosed, true, 'nothing in the background any more: the run ends as usual');
  assert.equal(writer.frames.at(-1).kind, 'complete');
  assert.equal(writer.frames.at(-1).exitCode, 0);
  assert.equal(writer.kinds().filter((kind) => kind === 'complete').length, 1);

  const phaseLines = journal.filter((line) => line.split(' ')[2] === 'phase');
  assert.equal(phaseLines.length, 2);
  assert.match(phaseLines[0], new RegExp(` phase session=app-${cli.sessionId} user=${userId} phase=parked agents=0 shells=1$`));
  assert.match(phaseLines[1], / phase=running agents=0 shells=0$/);
});

test('helpers alive between turns = «ждёт помощников»; only commands left = parked; the background gone with no new turn = the run completes', async (t) => {
  withHoldMs(t, 60_000);
  const journal = captureJournal(t);
  const { cli, writer, done } = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(cli, BASH, AGENT);
  await until(() => writer.phases().length === 1, 'the waiting frame');
  assert.equal(writer.phases()[0].phase, 'waiting_helpers');
  assert.deepEqual(writer.phases()[0].background, { agents: 1, shells: 1 });

  cli.emit(background(BASH));
  await until(() => writer.phases().length === 2, 'the parked frame');
  assert.equal(writer.phases()[1].phase, 'parked');
  assert.deepEqual(writer.phases()[1].background, { agents: 0, shells: 1 });
  assert.equal(writer.phases()[1].holdUntil, writer.phases()[0].holdUntil, 'one ceiling per turn end');

  cli.emit(background());
  await done;
  assert.equal(cli.stdinClosed, true);
  assert.equal(writer.frames.at(-1).kind, 'complete');
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', / reason=background_done$/);
});

test('the ceiling NEO3_CLAUDE_BACKGROUND_HOLD_MS ends the hold with the background still alive; 0 switches the hold off', async (t) => {
  withHoldMs(t, 600);
  const journal = captureJournal(t);
  const held = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(held.cli, BASH);
  await until(() => held.writer.phases().length === 1, 'the parked frame');
  await sleep(GRACE_MS * 3);
  assert.equal(held.cli.stdinClosed, false, 'held below the ceiling');

  await held.done;
  assert.equal(held.cli.stdinClosed, true);
  assert.equal(held.writer.frames.at(-1).kind, 'complete');
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', / reason=ceiling$/);

  process.env.NEO3_CLAUDE_BACKGROUND_HOLD_MS = '0';
  const off = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(off.cli, BASH);
  await off.done;
  assert.equal(off.cli.stdinClosed, true);
  assert.deepEqual(off.writer.phases(), []);
});

test('a message to a held run goes into the live process and starts a turn at once; mid-turn and after the release it is not taken', async (t) => {
  withHoldMs(t, 60_000);
  const { cli, writer, done } = startRun(t, { holdBackground: true });
  await until(() => cli.inputs.length === 1, 'the first message reached the CLI');
  cli.emit(running, init, background(BASH), say('жду'));
  await until(() => writer.texts().length === 1, 'the turn is going');
  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'посреди хода' }), false, 'mid-turn nothing is written into the process');

  cli.emit(result, idle);
  await until(() => writer.phases().length === 1, 'the parked frame');
  await sleep(GRACE_MS * 2);

  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'ответь "принял"' }), true);
  assert.deepEqual(writer.phases().map((frame) => frame.phase), ['parked', 'running'], 'the chat works again at once');
  await until(() => cli.inputs.length === 2, 'the message reached the CLI');
  assert.equal(cli.inputs[1].type, 'user');
  assert.deepEqual(cli.inputs[1].message, { role: 'user', content: [{ type: 'text', text: 'ответь "принял"' }] });
  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'второе подряд' }), false, 'the turn it started is going');

  // §9 scenario 1, 11.3 s: an ordinary new turn, the background lives on.
  cli.emit(running, init, say('принял'), result, idle);
  await until(() => writer.phases().length === 3, 'parked again');
  await sleep(GRACE_MS * 4);
  assert.equal(cli.stdinClosed, false, 'the background command was not killed by the message');
  assert.equal(writer.phases()[2].phase, 'parked');

  // The background ends with no turn after it: the input is released.
  cli.emit(background());
  await done;
  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'после конца' }), false);
  assert.equal(cli.inputs.length, 2, 'nothing was written twice');
});

test('«Стоп» on a held run and a sender that cannot share the process both end the hold, with the reason in the journal', async (t) => {
  withHoldMs(t, 60_000);
  const journal = captureJournal(t);
  const stopped = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(stopped.cli, BASH);
  await until(() => stopped.writer.phases().length === 1, 'the parked frame');

  assert.equal(await abortClaudeSDKSession(stopped.cli.sessionId), true);
  await stopped.done;
  assert.equal(stopped.cli.stdinClosed, true);
  assert.equal(stopped.writer.kinds().includes('complete'), false, 'the aborted complete is the gateway\'s');
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', new RegExp(`session=app-${stopped.cli.sessionId} user=${userId} reason=stop$`));

  journal.length = 0;
  const shared = startRun(t, { holdBackground: true });
  await firstTurnLeavingBackground(shared.cli, BASH);
  await until(() => shared.writer.phases().length === 1, 'the parked frame');
  assert.equal(releaseHeldClaudeRun(shared.cli.sessionId), true);
  await shared.done;
  assert.equal(shared.writer.frames.at(-1).kind, 'complete');
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', / reason=sender$/);
  assert.equal(releaseHeldClaudeRun(shared.cli.sessionId), false);
});

// Ремонт ветки (F1): the process keeps the settings of the message that
// started it. A message that asks for other ones must not run under them.
test('plan after bypass edits nothing: a message with another mode, model or effort is not written into the held process — the hold ends; the same settings (also after an approved plan) are taken', async (t) => {
  withHoldMs(t, 60_000);
  const journal = captureJournal(t);
  const bypass = { model: 'opus[1m]', effort: 'high', permissionMode: 'bypassPermissions' };

  const first = startRun(t, { holdBackground: true, ...bypass });
  await firstTurnLeavingBackground(first.cli, BASH);
  await until(() => first.writer.phases().length === 1, 'the parked frame');
  // This process edits files without asking anyone.
  assert.deepEqual(
    await first.cli.options.canUseTool('Write', { file_path: '/tmp/a.txt', content: 'x' }, {}),
    { behavior: 'allow', updatedInput: { file_path: '/tmp/a.txt', content: 'x' } },
  );

  assert.equal(sendToHeldClaudeRun(first.cli.sessionId, { command: 'сначала покажи план', ...bypass, permissionMode: 'plan' }), false);
  await first.done;
  assert.equal(first.cli.inputs.length, 1, 'the «план» message never reached the process with full access');
  assert.equal(first.cli.stdinClosed, true, 'the hold ended: the gateway starts an ordinary run with the message\'s own settings');
  assert.equal(first.writer.frames.at(-1).kind, 'complete');
  assert.equal(first.writer.frames.at(-1).exitCode, 0);
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', / reason=sender$/);

  // That ordinary run: plan mode, nothing pre-approved for writing.
  const plan = startRun(t, { holdBackground: true, ...bypass, permissionMode: 'plan' });
  await firstTurnLeavingBackground(plan.cli, BASH);
  await until(() => plan.writer.phases().length === 1, 'the parked frame');
  assert.equal(plan.cli.options.permissionMode, 'plan');

  // The same mode, no model or effort named (a message the server sends for the user): taken.
  assert.equal(sendToHeldClaudeRun(plan.cli.sessionId, { command: 'уточни шаг 2', permissionMode: 'plan' }), true);
  await until(() => plan.cli.inputs.length === 2, 'the message reached the CLI');

  // The person approves the plan in that turn: the process itself goes to full access…
  plan.cli.emit(running, init);
  const approval = plan.cli.options.canUseTool('ExitPlanMode', { plan: 'шаги' }, {});
  await until(() => plan.writer.kinds().includes('permission_request'), 'the plan prompt');
  resolveToolApproval(plan.writer.frames.find((frame) => frame.kind === 'permission_request').requestId, { allow: true });
  assert.equal((await approval).behavior, 'allow');
  plan.cli.emit(say('делаю по плану'), result, idle);
  await until(() => plan.writer.phases().length === 3, 'parked again');

  // …so the tab's next message, sent with the mode the approval switched to, is not «other settings».
  assert.equal(sendToHeldClaudeRun(plan.cli.sessionId, { command: 'дальше', ...bypass }), true);
  await until(() => plan.cli.inputs.length === 3, 'the message reached the CLI');
  plan.cli.emit(running, init, say('готово'), result, idle);
  await until(() => plan.writer.phases().length === 5, 'parked a third time');

  // Another model is other settings too.
  assert.equal(sendToHeldClaudeRun(plan.cli.sessionId, { command: 'x', ...bypass, model: 'sonnet[1m]' }), false);
  await plan.done;
  assert.equal(plan.cli.inputs.length, 3);

  // And another effort. A message that names no mode asks for the default one.
  const third = startRun(t, { holdBackground: true, ...bypass });
  await firstTurnLeavingBackground(third.cli, BASH);
  await until(() => third.writer.phases().length === 1, 'the parked frame');
  assert.equal(sendToHeldClaudeRun(third.cli.sessionId, { command: 'x', ...bypass, effort: 'max' }), false);
  await third.done;
  const fourth = startRun(t, { holdBackground: true, ...bypass });
  await firstTurnLeavingBackground(fourth.cli, BASH);
  await until(() => fourth.writer.phases().length === 1, 'the parked frame');
  assert.equal(sendToHeldClaudeRun(fourth.cli.sessionId, { command: 'x' }), false, 'no mode = «спрашивать», not full access');
  await fourth.done;
  assert.equal(fourth.cli.inputs.length, 1);
});

test('the hold ended for a sender while the CLI has not said idle yet: stdin stays open under the working CLI and is released with its idle — not at the two-hour ceiling', async (t) => {
  withHoldMs(t, 60_000);
  const journal = captureJournal(t);
  const { cli, writer, done } = startRun(t, { holdBackground: true, permissionMode: 'bypassPermissions' });
  await until(() => cli.inputs.length === 1, 'the first message reached the CLI');
  // The turn ended with a helper alive; the CLI has not reported idle.
  cli.emit(running, init, background(AGENT), say('жду помощника'), result);
  await until(() => writer.phases().length === 1, 'the waiting frame');
  assert.equal(writer.phases()[0].phase, 'waiting_helpers');

  assert.equal(sendToHeldClaudeRun(cli.sessionId, { command: 'сначала план', permissionMode: 'plan' }), false);
  await sleep(GRACE_MS * 3);
  assert.equal(cli.stdinClosed, false, 'not closed under a CLI that still works');
  assert.equal(cli.inputs.length, 1);

  cli.emit(idle);
  await done;
  assert.equal(cli.stdinClosed, true);
  assert.equal(writer.frames.at(-1).kind, 'complete');
  assert.match(journal.find((line) => line.split(' ')[2] === 'hold_release') ?? '', / reason=sender$/);
});
