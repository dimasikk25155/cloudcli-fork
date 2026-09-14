import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GROK_UNTITLED_SESSION_TITLE,
  composeGrokSessionTitle,
  readGrokFirstUserText,
  resolveGrokSessionTitle,
} from '@/modules/providers/list/grok/grok-session-title.js';

test('a long first prompt is named by its first words, not a guessed meaning', () => {
  const title = composeGrokSessionTitle(
    'Задачка, короче, мне не нравится то, что Грок Сессии, которые Он называет, называются на английском языке Можно это сделать, чтобы это было на русском, мне так проще ориентироваться А в идеале, если бы он вообще сам понимал суть первого сообщения И делал какое-то короткое название',
  );
  assert.equal(title, 'Задачка, короче, мне не нравится то, что Грок');
});

test('a long Russian first message keeps the opening words, including «я»', () => {
  const title = composeGrokSessionTitle(
    'я хочу добавить еще несколько фонов живых, вот тебе второй по мимо текущего, сразу для мобильной версии тоже сгенерировал, продумай это сразу',
  );
  assert.equal(title, 'Я хочу добавить еще несколько фонов живых, вот');
});

test('short Russian prompts stay as-is, including leading filler', () => {
  assert.equal(composeGrokSessionTitle('короче, поправь деплой на VPS'), 'Короче, поправь деплой на VPS');
  assert.equal(composeGrokSessionTitle('Привет'), 'Привет');
});

test('this-session style prompt uses the opening, not a verb in the middle', () => {
  const title = composeGrokSessionTitle(
    'я просил сессию называть коротко по смысле первого промта, результат меня разочаровал, сделай так чтобы первые слова моего промта называлась сессия',
  );
  assert.equal(title, 'Я просил сессию называть коротко по смысле первого');
});

test('envelope tags are stripped before naming', () => {
  const title = composeGrokSessionTitle(
    '<user_query><session_context>\nвольт\n</session_context>\n<work_mode_rules>\nRULE\n</work_mode_rules>\n\nсделай русские названия сессий</user_query>',
  );
  assert.equal(title, 'Сделай русские названия сессий');
});

test('an empty prompt falls back, an image-only prompt is labelled', () => {
  assert.equal(composeGrokSessionTitle(''), GROK_UNTITLED_SESSION_TITLE);
  assert.equal(
    composeGrokSessionTitle(
      '<images_input>\n1. /tmp/pic.png (original name: pic.png)\n</images_input>',
    ),
    'Картинка',
  );
});

test('a UI rename survives the English CLI auto-title', () => {
  assert.equal(
    resolveGrokSessionTitle({
      existingName: 'Как Дима назвал',
      cliTitle: 'One-Word Russian Hello Greeting Request',
      firstUserText: 'привет',
    }),
    'Как Дима назвал',
  );
});

test('a Grok /rename is kept even when it matches the CLI title', () => {
  assert.equal(
    resolveGrokSessionTitle({
      existingName: 'Мой чат',
      cliTitle: 'Мой чат',
      firstUserText: 'привет',
      titleIsManual: true,
    }),
    'Мой чат',
  );
});

test('the English CLI auto-title is replaced from the first Russian turn', () => {
  assert.equal(
    resolveGrokSessionTitle({
      existingName: 'Add live video backgrounds desktop and mobile',
      cliTitle: 'Add live video backgrounds desktop and mobile',
      firstUserText: 'я хочу добавить еще несколько фонов живых, вот тебе второй',
    }),
    'Я хочу добавить еще несколько фонов живых, вот',
  );
});

test('the first real user turn is read from Grok history, skipping harness noise', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'grok-title-'));
  const historyPath = path.join(dir, 'chat_history.jsonl');
  try {
    await writeFile(
      historyPath,
      [
        JSON.stringify({ type: 'system', content: 'You are Grok' }),
        JSON.stringify({
          type: 'user',
          content: [{ type: 'text', text: '<user_info>OS Version: linux</user_info>' }],
        }),
        JSON.stringify({
          type: 'user',
          synthetic_reason: 'system_reminder',
          content: [{ type: 'text', text: '<system-reminder>skills</system-reminder>' }],
        }),
        JSON.stringify({
          type: 'user',
          prompt_index: 0,
          content: [{
            type: 'text',
            text: '<user_query><session_context>вольт</session_context>\n\nпоправь названия сессий на русский</user_query>',
          }],
        }),
      ].join('\n'),
    );

    assert.equal(await readGrokFirstUserText(historyPath), 'поправь названия сессий на русский');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
