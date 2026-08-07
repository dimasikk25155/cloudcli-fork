import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import express from 'express';

// A repository import must never reach the developer's real auth.db, so the
// database path is redirected before the webhook module chain is loaded.
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'telegram-webhook-'));
const previousDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

const WEBHOOK_SECRET = 'correct-horse-battery-staple';

const webhookRoutes = (await import('@/modules/telegram/telegram-webhook.routes.js')).default;

let server: Server;
let baseUrl = '';

function postUpdate(headers: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/api/telegram-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    // No `message` key: the update is accepted but never touches the database.
    body: JSON.stringify({ update_id: 1 }),
  });
}

before(async () => {
  const app = express();
  app.use('/api/telegram-webhook', webhookRoutes);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind a port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  await rm(tempDirectory, { recursive: true, force: true });
});

test('without a bot token the webhook answers 503 and does nothing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;

  const response = await postUpdate({ 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET });

  assert.equal(response.status, 503);
});

test('without a configured secret the webhook stays shut', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
  delete process.env.TELEGRAM_WEBHOOK_SECRET;

  const response = await postUpdate({ 'X-Telegram-Bot-Api-Secret-Token': 'anything' });

  assert.equal(response.status, 503);
});

test('a wrong secret token is rejected with 401', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const response = await postUpdate({ 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' });

  assert.equal(response.status, 401);
});

test('a missing secret header is rejected with 401', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const response = await postUpdate({});

  assert.equal(response.status, 401);
});

test('a secret with the right length but wrong content is still rejected', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const response = await postUpdate({
    'X-Telegram-Bot-Api-Secret-Token': 'x'.repeat(WEBHOOK_SECRET.length),
  });

  assert.equal(response.status, 401);
});

test('the matching secret is accepted and acknowledged immediately', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const response = await postUpdate({ 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
