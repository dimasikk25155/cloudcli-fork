import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

// Inline keyboards, callback answers and message edits as Telegram receives
// them. Nothing leaves the process: fetch is replaced by a recorder.

const BOT_TOKEN = '123456:test-token-never-real-abcdefghij';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

const tempDirectory = await mkdtemp(path.join(tmpdir(), 'telegram-api-'));
const previousDatabasePath = process.env.DATABASE_PATH;
const databasePath = path.join(tempDirectory, 'auth.db');
writeFileSync(databasePath, '');
process.env.DATABASE_PATH = databasePath;

const { closeConnection } = await import('@/modules/database/connection.js');
const { initializeDatabase } = await import('@/modules/database/init-db.js');
const { telegramApi } = await import('@/modules/telegram/telegram-api.client.js');

await initializeDatabase();

type Call = { url: string; method: string; payload: Record<string, any> };

const originalFetch = globalThis.fetch;
let calls: Call[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true, result: true } };

globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input);
  calls.push({ url, method: url.split('/').pop() || '', payload: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(JSON.stringify(nextResponse.body), {
    status: nextResponse.status,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

beforeEach(() => {
  calls = [];
  nextResponse = { status: 200, body: { ok: true, result: true } };
});

after(async () => {
  globalThis.fetch = originalFetch;
  closeConnection();
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  await rm(tempDirectory, { recursive: true, force: true });
});

const keyboard = {
  inline_keyboard: [
    [{ text: 'Да', callback_data: 'a:abc' }],
    [{ text: 'Открыть в Neo3', url: 'https://neo3.example/session/s1' }],
  ],
};

test('sendMessage carries the inline keyboard and returns the sent message id', async () => {
  nextResponse = { status: 200, body: { ok: true, result: { message_id: 77, chat: { id: 5 } } } };

  const sent = await telegramApi.sendMessage('5', '<b>Вопрос</b>', { replyMarkup: keyboard });

  assert.equal(sent.message_id, 77);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.deepEqual(calls[0].payload.reply_markup, keyboard);
  assert.equal(calls[0].payload.parse_mode, 'HTML');
  assert.equal(calls[0].payload.chat_id, '5');
});

test('sendMessage without a keyboard sends no reply_markup', async () => {
  nextResponse = { status: 200, body: { ok: true, result: { message_id: 1 } } };
  await telegramApi.sendMessage('5', 'текст');
  assert.equal('reply_markup' in calls[0].payload, false);
});

test('answerCallbackQuery sends the popup text for that query', async () => {
  await telegramApi.answerCallbackQuery('cbq-1', 'Уже отвечено');
  assert.equal(calls[0].method, 'answerCallbackQuery');
  assert.deepEqual(calls[0].payload, { callback_query_id: 'cbq-1', text: 'Уже отвечено' });
});

test('editMessageText replaces the text and keyboard of one message', async () => {
  const linkOnly = { inline_keyboard: [[{ text: 'Открыть в Neo3', url: 'https://neo3.example/session/s1' }]] };
  await telegramApi.editMessageText('5', 77, 'Вопрос\n\n✓ Ответ: Да', { replyMarkup: linkOnly });

  assert.equal(calls[0].method, 'editMessageText');
  assert.equal(calls[0].payload.chat_id, '5');
  assert.equal(calls[0].payload.message_id, 77);
  assert.equal(calls[0].payload.text, 'Вопрос\n\n✓ Ответ: Да');
  assert.equal(calls[0].payload.parse_mode, 'HTML');
  assert.deepEqual(calls[0].payload.reply_markup, linkOnly);
});

test('editMessageReplyMarkup with no keyboard removes all buttons', async () => {
  await telegramApi.editMessageReplyMarkup('5', 77, null);
  assert.equal(calls[0].method, 'editMessageReplyMarkup');
  assert.deepEqual(calls[0].payload.reply_markup, { inline_keyboard: [] });
});

test('setWebhook subscribes to button presses as well as messages', async () => {
  await telegramApi.setWebhook('https://neo3.example/api/telegram-webhook', 'secret-1');
  assert.deepEqual(calls[0].payload.allowed_updates, ['message', 'callback_query']);
  assert.equal(calls[0].payload.secret_token, 'secret-1');
});

test('a Telegram failure surfaces without the bot token in the error', async () => {
  nextResponse = { status: 400, body: { ok: false, description: 'Bad Request: message is not modified' } };
  await assert.rejects(
    () => telegramApi.editMessageReplyMarkup('5', 77, null),
    (error: Error) => {
      assert.match(error.message, /editMessageReplyMarkup failed/);
      assert.equal(error.message.includes(BOT_TOKEN), false);
      return true;
    },
  );
});
