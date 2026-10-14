import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../stores/useSessionStore.js';
import { normalizedToChatMessages } from '../chat/hooks/useChatMessages.js';

import {
  activityFor,
  buildCrabSquad,
  crabBaseTitle,
  formatCrabDuration,
  crabStatusLine,
  pluralActions,
  squadSummary,
  tintForModel,
} from './crabModel.js';

const T0 = Date.parse('2026-10-13T06:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const base = { sessionId: 's', provider: 'claude' as const };

function agentCall(id: string, input: Record<string, unknown>, seconds = 0): NormalizedMessage {
  return { ...base, id, kind: 'tool_use', toolName: 'Agent', toolId: id, toolInput: input, timestamp: at(seconds) };
}

function asyncLaunched(id: string, model: string, seconds = 1): NormalizedMessage {
  return {
    ...base,
    id: `${id}_tr`,
    kind: 'tool_result',
    toolId: id,
    content: 'Async agent launched successfully.',
    toolUseResult: { isAsync: true, status: 'async_launched', resolvedModel: model },
    timestamp: at(seconds),
  } as NormalizedMessage;
}

function returned(id: string, seconds: number, status = 'completed'): NormalizedMessage {
  return {
    ...base,
    id: `${id}_back`,
    kind: 'task_notification',
    toolId: id,
    status,
    summary: 'Agent finished',
    usage: { toolUses: 14, durationMs: 65_000 },
    timestamp: at(seconds),
  };
}

const human: NormalizedMessage = { ...base, id: 'h', kind: 'text', role: 'user', content: 'Найди, где рисуются субагенты', timestamp: at(-5) };

test('model colours: haiku, sonnet, opus, fable, unknown', () => {
  assert.equal(tintForModel('claude-haiku-5-5'), 'haiku');
  assert.equal(tintForModel('sonnet'), 'sonnet');
  assert.equal(tintForModel('claude-opus-5-5[1m]'), 'opus');
  assert.equal(tintForModel('claude-fable-5-1'), 'fable');
  assert.equal(tintForModel(undefined), 'other');
});

test('activities are Russian words with an icon', () => {
  assert.deepEqual(activityFor('Read'), { verb: 'читает', icon: '📖' });
  assert.deepEqual(activityFor('Grep'), { verb: 'ищет', icon: '🔍' });
  assert.deepEqual(activityFor('Bash'), { verb: 'запускает', icon: '⚙️' });
  assert.deepEqual(activityFor('Edit'), { verb: 'пишет', icon: '✏️' });
  assert.deepEqual(activityFor('WebSearch'), { verb: 'в интернете', icon: '🌐' });
  assert.deepEqual(activityFor('mcp__ollama__chat'), { verb: 'в сервисе', icon: '🔌' });
  assert.deepEqual(activityFor(undefined), { verb: 'думает', icon: '💭' });
});

test('a Russian description is the name; an English one is replaced by the kind', () => {
  assert.equal(crabBaseTitle({ description: 'найти карточку субагента', subagent_type: 'Explore' }), 'Найти карточку субагента');
  assert.equal(crabBaseTitle({ description: 'Find subagent rendering', subagent_type: 'Explore' }), 'Разведчик');
  assert.equal(crabBaseTitle(JSON.stringify({ description: 'Design plan', subagent_type: 'Plan' })), 'Планировщик');
  assert.equal(crabBaseTitle({}), 'Помощник');
});

test('async crabs run until their notification arrives, then come back with effort and time', () => {
  const chat = normalizedToChatMessages([
    human,
    agentCall('a1', { description: 'Find code', subagent_type: 'Explore' }, 0),
    asyncLaunched('a1', 'claude-haiku-5-5'),
    agentCall('a2', { description: 'Check tests', subagent_type: 'Explore' }, 2),
    asyncLaunched('a2', 'claude-opus-5-5[1m]', 3),
    returned('a1', 70),
  ]);

  // The return folds into the crab: no extra English row in the chat.
  assert.equal(chat.filter((message) => message.isTaskNotification).length, 0);

  const squad = buildCrabSquad(chat, { isRunActive: true }, T0 + 90_000);
  assert.deepEqual(squad.map((crab) => [crab.title, crab.tint, crab.state]), [
    ['Разведчик №1', 'haiku', 'done'],
    ['Разведчик №2', 'opus', 'running'],
  ]);
  assert.equal(squad[0].toolsUsed, 14);
  assert.equal(squad[0].durationMs, 65_000);
  assert.equal(squad[1].durationMs, 88_000);
  assert.deepEqual(squad[1].activity, { verb: 'думает', icon: '💭' });

  const summary = squadSummary(squad, T0 + 90_000);
  assert.equal(summary.running, 1);
  assert.equal(summary.done, 1);
  assert.equal(summary.spanMs, 90_000);
});

test('background progress tells a running async crab what it is doing', () => {
  const chat = normalizedToChatMessages([
    human,
    agentCall('a1', { description: 'Find code', subagent_type: 'Explore' }, 0),
    asyncLaunched('a1', 'claude-sonnet-5-5'),
  ]);
  const [crab] = buildCrabSquad(chat, { isRunActive: true, backgroundLastTool: new Map([['a1', 'Grep']]) }, T0 + 5000);
  assert.deepEqual(crab.activity, { verb: 'ищет', icon: '🔍' });
});

test('a failed return and a crab left behind after the run ended', () => {
  const chat = normalizedToChatMessages([
    human,
    agentCall('a1', { description: 'x' }, 0),
    asyncLaunched('a1', 'opus'),
    agentCall('a2', { description: 'y' }, 1),
    asyncLaunched('a2', 'opus', 2),
    returned('a1', 30, 'failed'),
  ]);
  const squad = buildCrabSquad(chat, { isRunActive: false }, T0 + 60_000);
  assert.deepEqual(squad.map((crab) => crab.state), ['failed', 'lost']);
});

test('a foreground (sync) agent is back with its result; live child tools drive its activity', () => {
  const running = normalizedToChatMessages([
    human,
    agentCall('s1', { description: 'проверить сборку', subagent_type: 'general-purpose', model: 'haiku' }, 0),
    { ...base, id: 'c1', kind: 'tool_use', toolName: 'Bash', toolId: 'c1', toolInput: { command: 'npm test' }, parentToolUseId: 's1', timestamp: at(3) },
  ]);
  const [live] = buildCrabSquad(running, { isRunActive: true }, T0 + 10_000);
  assert.equal(live.title, 'Проверить сборку');
  assert.equal(live.tint, 'haiku');
  assert.equal(live.state, 'running');
  assert.deepEqual(live.activity, { verb: 'запускает', icon: '⚙️' });

  const done = normalizedToChatMessages([
    human,
    agentCall('s1', { description: 'проверить сборку', model: 'haiku' }, 0),
    {
      ...base, id: 's1_tr', kind: 'tool_result', toolId: 's1', content: 'All green', timestamp: at(40),
      toolUseResult: { totalToolUseCount: 3, totalDurationMs: 39_000 },
    } as NormalizedMessage,
  ]);
  const [back] = buildCrabSquad(done, { isRunActive: false }, T0 + 60_000);
  assert.equal(back.state, 'done');
  assert.equal(back.toolsUsed, 3);
  assert.equal(back.durationMs, 39_000);
});

test('only the current turn: crabs before the last human message are not in the squad', () => {
  const chat = normalizedToChatMessages([
    agentCall('old', { description: 'old' }, -100),
    human,
  ]);
  assert.deepEqual(buildCrabSquad(chat, { isRunActive: true }), []);
});

test('durations and action counts read naturally', () => {
  assert.equal(formatCrabDuration(4_306), '4 с');
  assert.equal(formatCrabDuration(42_000), '42 с');
  assert.equal(formatCrabDuration(200_000), '3 мин 20 с');
  assert.equal(formatCrabDuration(1_689_851), '28 мин');
  assert.equal(formatCrabDuration(3_727_000), '1 ч 2 мин');
  assert.equal(formatCrabDuration(undefined), '');
  assert.equal(pluralActions(1), '1 действие');
  assert.equal(pluralActions(3), '3 действия');
  assert.equal(pluralActions(11), '11 действий');
  assert.equal(pluralActions(14), '14 действий');
  assert.equal(pluralActions(22), '22 действия');
});

test('status lines read as sentences, not clock times', () => {
  const crab = { id: 'x', title: 'Разведчик', tint: 'opus' as const, toolsUsed: 14, activity: null };
  assert.equal(crabStatusLine({ ...crab, state: 'done', durationMs: 1_689_851 }, { withActions: true }), 'вернулся за 28 мин · 14 действий');
  assert.equal(crabStatusLine({ ...crab, state: 'running', activity: { verb: 'ищет', icon: '🔍' }, durationMs: 200_000 }), 'ищет · уже 3 мин 20 с');
  assert.equal(crabStatusLine({ ...crab, state: 'failed', durationMs: 5_000 }), 'вернулся с ошибкой за 5 с');
  assert.equal(crabStatusLine({ ...crab, state: 'lost' }), 'не вернулся');
});

// Grok: rows as the server emits them from `spawn_subagent` (see
// server/modules/providers/tests/grok-subagents.test.ts).
const grok = { sessionId: 's', provider: 'grok' as const };

function grokSpawn(id: string, input: Record<string, unknown>, seconds = 0): NormalizedMessage {
  return { ...grok, id, kind: 'tool_use', toolName: 'spawn_subagent', toolId: id, toolInput: input, timestamp: at(seconds) };
}

function grokResult(id: string, content: string, seconds = 1, parentToolUseId?: string): NormalizedMessage {
  return { ...grok, id: `${id}_result`, kind: 'tool_result', toolId: id, content, timestamp: at(seconds), parentToolUseId };
}

test('grok: a background helper is a red Grok crab until its return, then back with effort', () => {
  const rows: NormalizedMessage[] = [
    grokSpawn('g1', { prompt: 'Count .ts files', description: 'Считает файлы TS' }),
    grokResult('g1', 'subagent_id: 019a1b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b'),
    grokSpawn('g2', { prompt: 'Count .md files', description: 'Count markdown files' }),
    grokResult('g2', 'subagent_id: 019a1b2c-3d4e-7f00-9b2c-3d4e5f6a7b8c'),
    { ...grok, id: 'c1', kind: 'tool_use', toolName: 'read_file', toolId: 'c1', toolInput: { target_file: 'src/a.ts' }, timestamp: at(5), parentToolUseId: 'g1' },
    { ...grok, id: 'cmd', kind: 'tool_use', toolName: 'run_terminal_command', toolId: 'cmd', toolInput: { command: 'sleep 5' }, timestamp: at(2) },
  ];
  const [running, english] = buildCrabSquad(normalizedToChatMessages(rows), { isRunActive: true }, T0 + 30_000);
  assert.equal(running.title, 'Считает файлы TS');
  assert.equal(running.tint, 'grok');
  assert.equal(running.state, 'running');
  assert.deepEqual(running.activity, { verb: 'читает', icon: '📖' });
  assert.equal(english.title, 'Помощник');
  assert.equal(buildCrabSquad(normalizedToChatMessages(rows), { isRunActive: true }).length, 2);

  const back = normalizedToChatMessages([
    ...rows,
    { ...grok, id: 'n1', kind: 'task_notification', toolId: 'g1', status: 'completed', summary: '', usage: { toolUses: 7, durationMs: 64_000 }, timestamp: at(70) },
    { ...grok, id: 'n2', kind: 'task_notification', toolId: 'g2', status: 'cancelled', summary: '', timestamp: at(80) },
  ]);
  const [done, stopped] = buildCrabSquad(back, { isRunActive: false }, T0 + 100_000);
  assert.equal(done.state, 'done');
  assert.equal(done.toolsUsed, 7);
  assert.equal(done.durationMs, 64_000);
  assert.equal(stopped.state, 'failed');
  assert.equal(stopped.durationMs, 80_000);
  assert.equal(back.some((message) => message.isTaskNotification), false);
});

test('grok: a blocking helper (background:false) is back with its result', () => {
  const chat = normalizedToChatMessages([
    grokSpawn('g3', { prompt: 'p', description: 'Считает заметки', background: false }),
    grokResult('g3', 'There are 3 .md files.\nsubagent_id: 019a1b2c-3d4e-7f00-9b2c-3d4e5f6a7b8c', 40),
  ]);
  const [crab] = buildCrabSquad(chat, { isRunActive: true }, T0 + 50_000);
  assert.equal(crab.state, 'done');
  assert.equal(crab.durationMs, 40_000);
});

test('grok tool names read as Russian activities', () => {
  assert.equal(tintForModel('grok-4.7-build-fast'), 'grok');
  assert.equal(activityFor('grep').verb, 'ищет');
  assert.equal(activityFor('run_terminal_command').verb, 'запускает');
  assert.equal(activityFor('search_replace').verb, 'пишет');
  assert.equal(activityFor('web_fetch').verb, 'в интернете');
  assert.equal(activityFor('image_gen').verb, 'рисует');
});
