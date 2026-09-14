import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from './useSessionStore.js';
import {
  computeMerged,
  pruneRealtimeSupersededByServer,
} from './sessionMessageMerge.js';

const SESSION = 'aad44676-5c87-40b0-b56b-4177441221a0';

test('Codex snapshot missing a user row never moves the local prompt below its persisted answer', () => {
  const question = msg({ id: 'local_codex', provider: 'codex', kind: 'text', role: 'user', content: 'Потянет VPS?', timestamp: '2026-09-14T07:20:42Z' });
  const previousAnswer = msg({ id: 'previous', provider: 'codex', kind: 'text', role: 'assistant', content: 'Предыдущий ответ', timestamp: '2026-09-14T07:16:09Z' });
  const currentAnswer = msg({ id: 'current', provider: 'codex', kind: 'text', role: 'assistant', content: 'Проверяю сервер', timestamp: '2026-09-14T07:20:55Z' });
  const completed = msg({ id: 'completed', provider: 'codex', kind: 'text', role: 'assistant', content: 'Итоговая оценка', timestamp: '2026-09-14T07:22:43Z' });
  assert.deepEqual(computeMerged([previousAnswer, currentAnswer], [question]).map((row) => row.id), ['previous', 'local_codex', 'current']);
  assert.deepEqual(computeMerged([previousAnswer, currentAnswer, completed], [question]).map((row) => row.id), ['previous', 'local_codex', 'current', 'completed']);
});

test('Codex keeps an immediate identical retry after an aborted turn with no answer', () => {
  const previous = msg({ id: 'native-user', provider: 'codex', kind: 'text', role: 'user', content: 'Продолжи', timestamp: '2026-09-14T07:20:42Z' });
  const retry = msg({ ...previous, id: 'local_retry', timestamp: '2026-09-14T07:20:43Z' });
  assert.deepEqual(computeMerged([previous], [retry]).map((row) => row.id), ['native-user', 'local_retry']);
  assert.deepEqual(pruneRealtimeSupersededByServer([previous], [retry]), [retry]);
});

function msg(partial: Partial<NormalizedMessage> & Pick<NormalizedMessage, 'id' | 'kind'>): NormalizedMessage {
  return {
    sessionId: SESSION,
    timestamp: '2026-09-04T09:16:44.000Z',
    provider: 'grok',
    ...partial,
  } as NormalizedMessage;
}

test('Grok history stamped now() does not pull the live answer above the user bubble', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'И запомню важное правило, короче, когда я говорю бот в контексте этого проекта',
    timestamp: '2026-09-04T09:16:44.000Z',
  });
  const serverAnswer = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка менеджера, ты переписку не смотришь.',
    timestamp: '2026-09-04T09:16:44.000Z',
  });
  const liveAnswer = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка менеджера, ты переписку не смотришь.',
    timestamp: '2026-09-04T09:16:31.000Z',
  });

  const merged = computeMerged([user, serverAnswer], [liveAnswer]);

  assert.equal(merged[0]?.id, 'srv-user');
  assert.deepEqual(merged.map((row) => row.role), ['user', 'assistant']);
  assert.equal(merged.filter((row) => (row.content || '').includes('WhatsApp-бота')).length, 1);
});

test('a growing live answer replaces the shorter disk snapshot instead of stacking', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Запомни правило',
  });
  const diskPrefix = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог',
  });
  const liveLonger = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка менеджера.',
    timestamp: '2026-09-04T09:16:31.000Z',
  });

  const merged = computeMerged([user, diskPrefix], [liveLonger]);
  assert.deepEqual(merged.map((row) => row.role), ['user', 'assistant']);
  assert.equal(merged[1]?.content, liveLonger.content);
});

test('local user echo is dropped once the same prompt is on disk, even with a later parse time', () => {
  const serverUser = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Запомни правило',
    timestamp: '2026-09-04T09:16:44.000Z',
  });
  const localUser = msg({
    id: 'local_123_abc',
    kind: 'text',
    role: 'user',
    content: 'Запомни правило',
    timestamp: '2026-09-04T09:16:31.000Z',
  });
  const liveAnswer = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Принял, записываю правило в карточку WhatsApp-бота.',
    timestamp: '2026-09-04T09:16:32.000Z',
  });

  const merged = computeMerged([serverUser], [localUser, liveAnswer]);
  assert.equal(merged.filter((row) => row.role === 'user').length, 1);
  assert.equal(merged[0]?.id, 'srv-user');
  assert.equal(merged[1]?.id, 'live-asst');
});

test('a second identical prompt after an answer is kept as a new turn', () => {
  const first = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'ок',
    timestamp: '2026-09-04T09:10:00.000Z',
  });
  const answer = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Сделано.',
    timestamp: '2026-09-04T09:10:05.000Z',
  });
  const secondLocal = msg({
    id: 'local_999_ok',
    kind: 'text',
    role: 'user',
    content: 'ок',
    timestamp: '2026-09-04T09:16:44.000Z',
  });

  const merged = computeMerged([first, answer], [secondLocal]);
  assert.deepEqual(merged.map((row) => row.id), ['srv-user-1', 'srv-asst', 'local_999_ok']);
});

test('an older same-text greeting does not swallow a new local send', () => {
  const oldHello = msg({
    id: 'old-hello',
    kind: 'text',
    role: 'user',
    content: 'привет',
    timestamp: '2026-09-04T10:00:00.000Z',
  });
  const answer = msg({
    id: 'old-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Здравствуй.',
    timestamp: '2026-09-04T10:00:05.000Z',
  });
  const localHello = msg({
    id: 'local_hello_2',
    kind: 'text',
    role: 'user',
    content: 'привет',
    timestamp: '2026-09-04T13:14:00.000Z',
  });

  const merged = computeMerged([oldHello, answer], [localHello]);
  assert.equal(merged.at(-1)?.id, 'local_hello_2');
  assert.equal(merged.filter((row) => row.role === 'user').length, 2);
});

test('Grok history stamped with one now() still keeps every user turn', () => {
  const ts = '2026-09-04T18:27:14.305Z';
  const user1 = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'давай попробуем запустить рекламу теперь на сайт',
    timestamp: ts,
  });
  const answer1 = msg({
    id: 'srv-asst-1',
    kind: 'text',
    role: 'assistant',
    content: 'Первый ответ достаточно длинный, чтобы его не схлопнуло с соседним.',
    timestamp: ts,
  });
  const user2 = msg({
    id: 'srv-user-2',
    kind: 'text',
    role: 'user',
    content: 'вот что есть когда создаешь компанию на лид и продажи',
    timestamp: ts,
  });
  const answer2 = msg({
    id: 'srv-asst-2',
    kind: 'text',
    role: 'assistant',
    content: 'Второй ответ тоже длинный текст, не префикс первого.',
    timestamp: ts,
  });
  const local2 = msg({
    id: 'local_user_2',
    kind: 'text',
    role: 'user',
    content: 'вот что есть когда создаешь компанию на лид и продажи',
    timestamp: ts,
  });

  const merged = computeMerged([user1, answer1, user2, answer2], [local2]);
  assert.deepEqual(
    merged.filter((row) => row.role === 'user').map((row) => row.content),
    [user1.content, user2.content],
  );
  assert.equal(merged.filter((row) => row.id.startsWith('local_')).length, 0);
});

test('a new prompt stays last even when a leftover live answer is still in realtime', () => {
  const previousUser = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'Первый вопрос',
  });
  const previousAnswer = msg({
    id: 'srv-asst-1',
    kind: 'text',
    role: 'assistant',
    content: 'Первый ответ уже на диске.',
  });
  const leftoverLive = msg({
    id: 'live-asst-old',
    kind: 'text',
    role: 'assistant',
    content: 'Первый ответ уже на диске.',
    timestamp: '2026-09-04T09:16:31.000Z',
  });
  const localNext = msg({
    id: 'local_next',
    kind: 'text',
    role: 'user',
    content: 'А теперь второе',
    timestamp: '2026-09-04T13:14:00.000Z',
  });

  const merged = computeMerged(
    [previousUser, previousAnswer],
    [leftoverLive, localNext],
  );
  assert.equal(merged.at(-1)?.id, 'local_next');
  assert.equal(merged.filter((row) => row.role === 'user').at(-1)?.content, 'А теперь второе');
});

test('prune drops the live assistant once the same turn is on disk', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Запомни правило',
  });
  const serverAnswer = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка.',
  });
  const liveAnswer = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка.',
    timestamp: '2026-09-04T09:16:31.000Z',
  });

  const leftover = pruneRealtimeSupersededByServer([user, serverAnswer], [liveAnswer]);
  assert.deepEqual(leftover, []);
});

test('a non-adjacent live pack is collapsed onto the disk pack instead of repeating', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Чё это за хуйня вчера вечером была',
  });
  const lines = [
    'На скрине бот на «Оба» и «Мм» отвечает одно и то же: «В этом размере ничего нет».',
    'В памяти это тот WhatsApp-бот шин: вчера в 15:37 как раз меняли фразу.',
    'Похоже, после «нет в наличии» бот не запоминает, что уже сказал это.',
    'Баг ясен: пустой каталог шлёт фразу, но не запоминает это.',
  ];
  const serverPack = lines.map((content, index) => msg({
    id: `grok_hist_${SESSION}_${index + 1}_text_assistant`,
    kind: 'text',
    role: 'assistant',
    content,
  }));
  const livePack = [
    ...lines.map((content, index) => msg({
      id: `live-${index}`,
      kind: 'text',
      role: 'assistant',
      content,
    })),
    msg({
      id: 'live-tail',
      kind: 'text',
      role: 'assistant',
      content: 'Сейчас разберу скрин и логи бота: сначала пойму, какой именно текст уходил клиентам.',
    }),
  ];

  const merged = computeMerged([user, ...serverPack], livePack);
  assert.deepEqual(
    merged.filter((row) => row.role === 'assistant').map((row) => row.content),
    [...lines, livePack[4].content],
  );
  assert.equal(merged[0]?.id, 'srv-user');
});

test('duplicated assistant rows on disk alone still collapse inside the turn', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Разберись раз и навсегда',
  });
  const first = msg({
    id: 'hist-a',
    kind: 'text',
    role: 'assistant',
    content: 'На скрине бот на «Оба» и «Мм» отвечает одно и то же длинное предложение.',
  });
  const second = msg({
    id: 'hist-b',
    kind: 'text',
    role: 'assistant',
    content: 'В памяти это тот WhatsApp-бот шин, фраза ушла на оба размера.',
  });
  const firstAgain = msg({
    id: 'hist-a-copy',
    kind: 'text',
    role: 'assistant',
    content: first.content,
  });
  const secondAgain = msg({
    id: 'hist-b-copy',
    kind: 'text',
    role: 'assistant',
    content: second.content,
  });

  const merged = computeMerged([user, first, second, firstAgain, secondAgain], []);
  assert.deepEqual(
    merged.filter((row) => row.role === 'assistant').map((row) => row.id),
    ['hist-a', 'hist-b'],
  );
});

test('the same assistant sentence in two user turns is kept twice', () => {
  const user1 = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'Первый вопрос достаточно длинный',
  });
  const answer1 = msg({
    id: 'srv-asst-1',
    kind: 'text',
    role: 'assistant',
    content: 'Да, сделал это и записал в карточку проекта.',
  });
  const user2 = msg({
    id: 'srv-user-2',
    kind: 'text',
    role: 'user',
    content: 'Повтори то же самое ещё раз',
  });
  const answer2 = msg({
    id: 'live-asst-2',
    kind: 'text',
    role: 'assistant',
    content: 'Да, сделал это и записал в карточку проекта.',
  });

  const merged = computeMerged([user1, answer1, user2], [answer2]);
  assert.equal(merged.filter((row) => row.role === 'assistant').length, 2);
  assert.equal(merged.at(-1)?.id, 'live-asst-2');
});

test('live tools stay when the disk snapshot of this turn has not caught up yet', () => {
  const previousUser = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'Первый вопрос',
  });
  const previousAnswer = msg({
    id: 'srv-asst-1',
    kind: 'text',
    role: 'assistant',
    content: 'Первый ответ уже на диске.',
  });
  const localNext = msg({
    id: 'local_next_tools',
    kind: 'text',
    role: 'user',
    content: 'Посмотри файлы',
    timestamp: '2026-09-06T05:45:00.000Z',
  });
  const liveTool = msg({
    id: 'live-tool-read',
    kind: 'tool_use',
    toolId: 'call-read-live',
    toolName: 'read_file',
    content: '',
  });

  const merged = computeMerged(
    [previousUser, previousAnswer],
    [localNext, liveTool],
  );
  assert.deepEqual(
    merged.map((row) => row.id),
    ['srv-user-1', 'srv-asst-1', 'local_next_tools', 'live-tool-read'],
  );
});

test('same toolId from disk and live is shown once', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Посмотри файл',
  });
  const diskTool = msg({
    id: 'hist-tool',
    kind: 'tool_use',
    toolId: 'call-read-1',
    toolName: 'read_file',
    content: '',
  });
  const liveTool = msg({
    id: 'live-tool',
    kind: 'tool_use',
    toolId: 'call-read-1',
    toolName: 'read_file',
    content: '',
  });

  const merged = computeMerged([user, diskTool], [liveTool]);
  assert.equal(merged.filter((row) => row.kind === 'tool_use').length, 1);
  assert.equal(merged[1]?.id, 'hist-tool');
});

test('prune keeps a live answer that is still longer than the disk prefix', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Запомни правило',
  });
  const diskPrefix = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог',
  });
  const liveLonger = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Запоминаю правило про WhatsApp-бота: он сам ведёт диалог — каталог или кнопка менеджера.',
  });

  const leftover = pruneRealtimeSupersededByServer([user, diskPrefix], [liveLonger]);
  assert.equal(leftover.length, 1);
  assert.equal(leftover[0]?.id, 'live-asst');
});

test('whitespace-only drift still collapses the live answer onto the disk snapshot', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'точнее ты дай',
  });
  const disk = msg({
    id: 'grok_hist_asst',
    kind: 'text',
    role: 'assistant',
    content: 'Даю ссылки, не названия. Ищу точные ролики на YouTube Music.\nЖми сразу это: https://youtu.be/Raofh8yzYXY — Echo Inside Me.',
  });
  const live = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'Даю ссылки, не названия. Ищу точные ролики на YouTube Music.Жми сразу это: https://youtu.be/Raofh8yzYXY — Echo Inside Me. Потом очередь ниже, всё кликабельно.',
  });

  const merged = computeMerged([user, disk], [live]);
  assert.deepEqual(merged.map((row) => row.role), ['user', 'assistant']);
  assert.equal(merged[1]?.id, 'live-asst');
});

test('a leftover previous answer after the next prompt is dropped, not shown twice', () => {
  const links = [
    'Даю ссылки, не названия. Ищу точные ролики на YouTube Music. Жми сразу это: https://youtu.be/Raofh8yzYXY — Echo Inside Me.',
    'Потом очередь ниже, всё кликабельно. Сейчас, по порядку: Black Feather, In the Space Between the Silence, MAKE A RUIN OF ME.',
    'Создатель точнее, чем имя в кредитах, из открытого нет. На Shazam так: Атанян Виктория Ивановна. Инстаграма певицы нет.',
  ].join(' ');
  const user1 = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'точнее ты дай',
  });
  const answer1 = msg({
    id: 'grok_hist_asst',
    kind: 'text',
    role: 'assistant',
    content: links,
  });
  const user2 = msg({
    id: 'local_links',
    kind: 'text',
    role: 'user',
    content: 'Атанян Виктория Ивановна, линки дать?',
    timestamp: '2026-09-05T16:15:18.000Z',
  });
  const leftoverTruncated = msg({
    id: 'replay-asst',
    kind: 'text',
    role: 'assistant',
    content: links.slice(0, 180),
  });

  const merged = computeMerged([user1, answer1], [user2, leftoverTruncated]);
  assert.deepEqual(
    merged.map((row) => row.role),
    ['user', 'assistant', 'user'],
  );
  assert.equal(merged.filter((row) => (row.content || '').includes('Даю ссылки')).length, 1);
  assert.equal(merged.at(-1)?.id, 'local_links');
});

test('prune drops a previous-turn leftover even after a new local prompt', () => {
  const links = 'Даю ссылки, не названия. Ищу точные ролики на YouTube Music. Жми сразу это: https://youtu.be/Raofh8yzYXY — Echo Inside Me. Потом очередь ниже, всё кликабельно.';
  const user1 = msg({
    id: 'srv-user-1',
    kind: 'text',
    role: 'user',
    content: 'точнее ты дай',
  });
  const answer1 = msg({
    id: 'grok_hist_asst',
    kind: 'text',
    role: 'assistant',
    content: links,
  });
  const user2 = msg({
    id: 'local_links',
    kind: 'text',
    role: 'user',
    content: 'Атанян Виктория Ивановна, линки дать?',
  });
  const leftover = msg({
    id: 'replay-asst',
    kind: 'text',
    role: 'assistant',
    content: links,
  });

  const leftoverAfter = pruneRealtimeSupersededByServer(
    [user1, answer1],
    [user2, leftover],
  );
  assert.deepEqual(leftoverAfter.map((row) => row.id), ['local_links']);
});

test('a long Grok turn does not append the sent prompt again under the answer', () => {
  const serverUser = msg({
    id: 'grok_hist_user',
    kind: 'text',
    role: 'user',
    content: 'Пожалуйста, исправь баг с чатом',
    timestamp: '2026-09-11T14:30:00.000Z',
  });
  const serverAnswer = msg({
    id: 'grok_hist_asst',
    kind: 'text',
    role: 'assistant',
    content: 'Исправляю: после ответа пузырь больше не должен повторяться внизу.',
    timestamp: '2026-09-11T14:30:00.000Z',
  });
  const localUser = msg({
    id: 'local_long_turn',
    kind: 'text',
    role: 'user',
    content: 'Пожалуйста, исправь баг с чатом',
    timestamp: '2026-09-11T14:18:00.000Z',
  });

  const merged = computeMerged([serverUser, serverAnswer], [localUser]);
  assert.equal(merged.filter((row) => row.role === 'user').length, 1);
  assert.equal(merged.at(-1)?.role, 'assistant');
  assert.equal(merged.filter((row) => row.id.startsWith('local_')).length, 0);

  const leftover = pruneRealtimeSupersededByServer(
    [serverUser, serverAnswer],
    [localUser],
  );
  assert.deepEqual(leftover, []);
});

test('local user echo does not shift the live assistant into the next turn for prune', () => {
  const user = msg({
    id: 'srv-user',
    kind: 'text',
    role: 'user',
    content: 'Чё это за хуйня вчера вечером была',
  });
  const serverAnswer = msg({
    id: 'srv-asst',
    kind: 'text',
    role: 'assistant',
    content: 'На скрине бот на «Оба» и «Мм» отвечает одно и то же длинное предложение.',
  });
  const localUser = msg({
    id: 'local_prompt',
    kind: 'text',
    role: 'user',
    content: 'Чё это за хуйня вчера вечером была',
  });
  const liveAnswer = msg({
    id: 'live-asst',
    kind: 'text',
    role: 'assistant',
    content: 'На скрине бот на «Оба» и «Мм» отвечает одно и то же длинное предложение.',
  });

  const leftover = pruneRealtimeSupersededByServer(
    [user, serverAnswer],
    [localUser, liveAnswer],
  );
  assert.deepEqual(leftover, []);
});
