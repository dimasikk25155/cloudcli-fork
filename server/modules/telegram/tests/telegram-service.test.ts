import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

// The bot must look configured before anything calls the Bot API, and the
// database must point at a throwaway file before any repository opens it.
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-not-a-real-one';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';

const tempDirectory = await mkdtemp(path.join(tmpdir(), 'telegram-service-'));
const previousDatabasePath = process.env.DATABASE_PATH;
const databasePath = path.join(tempDirectory, 'auth.db');
// Touching the file first stops the connection layer from copying a developer's
// legacy auth.db into this test — the fixtures below must be the only data here.
writeFileSync(databasePath, '');
process.env.DATABASE_PATH = databasePath;

const { closeConnection } = await import('@/modules/database/connection.js');
const { initializeDatabase } = await import('@/modules/database/init-db.js');
const { projectsDb } = await import('@/modules/database/repositories/projects.db.js');
const { userDb } = await import('@/modules/database/repositories/users.js');
const { userProjectAccessDb } = await import('@/modules/database/repositories/user-project-access.js');
const { telegramDb } = await import('@/modules/database/repositories/telegram.db.js');
const {
  TELEGRAM_MESSAGE_LIMIT,
  escapeHtml,
  handleTelegramUpdate,
  issueLinkCode,
  setPromptRunnerForTests,
} = await import('@/modules/telegram/telegram.service.js');

type BotCall = {
  method: string;
  payload: Record<string, any>;
};

const originalFetch = globalThis.fetch;
let botCalls: BotCall[] = [];

/** Records every Bot API call instead of performing it. Nothing leaves the process. */
function installFetchRecorder(): void {
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    if (!url.startsWith('https://api.telegram.org/')) {
      throw new Error(`Unexpected outbound request in tests: ${url}`);
    }

    botCalls.push({
      method: url.split('/').pop() || '',
      payload: JSON.parse(String(init?.body ?? '{}')),
    });

    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function sentMessages(): string[] {
  return botCalls.filter((call) => call.method === 'sendMessage').map((call) => String(call.payload.text));
}

function textMessage(chatId: string, text: string): unknown {
  return { update_id: 1, message: { chat: { id: chatId }, from: { username: 'tester' }, text } };
}

const PROJECT_GRANTED = '/workspace/granted-project';
const PROJECT_FOREIGN = '/workspace/foreign-project';

let memberId = 0;
let outsiderId = 0;

before(async () => {
  await initializeDatabase();
  installFetchRecorder();

  memberId = Number(userDb.createUser('member', 'hash').id);
  outsiderId = Number(userDb.createUser('outsider', 'hash').id);

  const granted = projectsDb.createProjectPath(PROJECT_GRANTED, 'Granted Project');
  projectsDb.createProjectPath(PROJECT_FOREIGN, 'Foreign Project');
  userProjectAccessDb.grantAccess(memberId, granted.project!.project_id, null);
});

beforeEach(() => {
  botCalls = [];
  setPromptRunnerForTests(null);
});

after(async () => {
  globalThis.fetch = originalFetch;
  setPromptRunnerForTests(null);
  closeConnection();

  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  await rm(tempDirectory, { recursive: true, force: true });

  // The run path pulls in the shared agent-run service, whose engine modules
  // start a cleanup interval at import time (server/openai-codex.js) and leave
  // an SDK pipe open. Those handles are not this feature's to close, and without
  // this the worker would hang forever after the last test. Results are already
  // reported by now, so a failing run still exits non-zero.
  process.exit(0);
});

// --- fail-closed: an unbound chat learns nothing --------------------------------

test('an unbound chat gets only the "not linked" notice and no run', async () => {
  let runnerCalled = false;
  setPromptRunnerForTests((async () => {
    runnerCalled = true;
    return { sessionId: null, text: 'leaked', messages: [] };
  }) as any);

  await handleTelegramUpdate(textMessage('900001', 'посмотри что в проекте и удали лишнее'));

  const messages = sentMessages();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /не привязан/);
  assert.equal(runnerCalled, false);
  assert.equal(botCalls.some((call) => call.method === 'sendChatAction'), false);
});

test('an unbound chat cannot list projects through /project or /help', async () => {
  await handleTelegramUpdate(textMessage('900002', '/project'));
  await handleTelegramUpdate(textMessage('900002', '/help'));

  const messages = sentMessages();
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.match(message, /не привязан/);
    assert.doesNotMatch(message, /workspace/);
    assert.doesNotMatch(message, /Granted Project|Foreign Project/);
  }
});

test('an unbound chat cannot bind itself with a made-up code', async () => {
  await handleTelegramUpdate(textMessage('900003', '/start TOTALLYFAKE'));

  assert.match(sentMessages()[0], /Код не подошёл/);
  assert.equal(telegramDb.getBindingByChatId('900003'), null);
});

test('a disabled binding is treated as unbound', async () => {
  telegramDb.upsertBinding({ userId: memberId, chatId: '900004', projectPath: PROJECT_GRANTED });
  telegramDb.setBindingEnabled(memberId, '900004', false);

  await handleTelegramUpdate(textMessage('900004', 'сделай что-нибудь'));

  assert.match(sentMessages()[0], /не привязан/);
});

// --- linking ------------------------------------------------------------------

test('a valid link code binds the chat once and cannot be replayed', async () => {
  const { code } = issueLinkCode(memberId);

  await handleTelegramUpdate(textMessage('900005', `/start ${code}`));

  const binding = telegramDb.getBindingByChatId('900005');
  assert.ok(binding);
  assert.equal(binding?.user_id, memberId);
  assert.match(sentMessages()[0], /Чат привязан к пользователю member/);

  botCalls = [];
  await handleTelegramUpdate(textMessage('900006', `/start ${code}`));

  assert.equal(telegramDb.getBindingByChatId('900006'), null);
  assert.match(sentMessages()[0], /Код не подошёл/);
});

test('an expired link code does not bind', async () => {
  telegramDb.createLinkCode(outsiderId, 'EXPIRED1', 1);
  // Push the expiry into the past instead of waiting for it.
  const { getConnection } = await import('@/modules/database/connection.js');
  getConnection()
    .prepare("UPDATE telegram_link_codes SET expires_at = datetime('now', '-1 hour') WHERE code = ?")
    .run('EXPIRED1');

  await handleTelegramUpdate(textMessage('900007', '/start EXPIRED1'));

  assert.equal(telegramDb.getBindingByChatId('900007'), null);
  assert.match(sentMessages()[0], /Код не подошёл/);
});

// --- project scoping ----------------------------------------------------------

test('/project lists only the projects the bound user was granted', async () => {
  telegramDb.upsertBinding({ userId: memberId, chatId: '900008' });

  await handleTelegramUpdate(textMessage('900008', '/project'));

  const message = sentMessages()[0];
  assert.match(message, /Granted Project/);
  assert.doesNotMatch(message, /Foreign Project/);
});

test('/project refuses a project the bound user was never granted', async () => {
  telegramDb.upsertBinding({ userId: memberId, chatId: '900009' });

  await handleTelegramUpdate(textMessage('900009', `/project ${PROJECT_FOREIGN}`));

  assert.equal(telegramDb.getBindingByChatId('900009')?.project_path, null);
  assert.match(sentMessages()[0], /Не нашёл такой проект/);
});

test('a chat pointed at a foreign project never reaches the agent', async () => {
  let runnerCalled = false;
  setPromptRunnerForTests((async () => {
    runnerCalled = true;
    return { sessionId: null, text: 'leaked', messages: [] };
  }) as any);

  // Simulates a stale/tampered row: the project was set while access still existed.
  telegramDb.upsertBinding({ userId: memberId, chatId: '900010', projectPath: PROJECT_FOREIGN });

  await handleTelegramUpdate(textMessage('900010', 'покажи файлы'));

  assert.equal(runnerCalled, false);
  assert.match(sentMessages()[0], /Нет доступа к проекту/);
});

// --- running ------------------------------------------------------------------

test('a bound chat runs in its project, keeps the session and shows typing', async () => {
  const seenSessionIds: (string | null)[] = [];
  setPromptRunnerForTests((async (options: any) => {
    seenSessionIds.push(options.sessionId ?? null);
    return { sessionId: 'session-42', text: 'готово', messages: [] };
  }) as any);

  telegramDb.upsertBinding({ userId: memberId, chatId: '900011', projectPath: PROJECT_GRANTED });

  await handleTelegramUpdate(textMessage('900011', 'первый вопрос'));
  await handleTelegramUpdate(textMessage('900011', 'второй вопрос'));

  assert.deepEqual(seenSessionIds, [null, 'session-42']);
  assert.ok(botCalls.some((call) => call.method === 'sendChatAction'));
  assert.deepEqual(sentMessages(), ['готово', 'готово']);

  botCalls = [];
  await handleTelegramUpdate(textMessage('900011', '/new'));
  await handleTelegramUpdate(textMessage('900011', 'третий вопрос'));

  assert.equal(seenSessionIds[2], null, '/new must start a fresh session');
});

test('a long answer is delivered as several messages within the Telegram limit', async () => {
  const longAnswer = Array.from({ length: 500 }, (_, index) => `${index}: строка ответа <b>агента</b> & прочее`).join('\n');
  setPromptRunnerForTests((async () => ({ sessionId: 'session-long', text: longAnswer, messages: [] })) as any);

  telegramDb.upsertBinding({ userId: memberId, chatId: '900012', projectPath: PROJECT_GRANTED });

  await handleTelegramUpdate(textMessage('900012', 'дай длинный ответ'));

  const messages = sentMessages();
  assert.ok(messages.length > 1, `expected the answer to be split, got ${messages.length} message(s)`);
  for (const message of messages) {
    assert.ok(message.length <= TELEGRAM_MESSAGE_LIMIT, `message of ${message.length} characters exceeds the limit`);
    assert.doesNotMatch(message, /<b>/, 'markup must be escaped, not sent as HTML');
  }
  assert.equal(messages.join('\n'), escapeHtml(longAnswer));
});

test('an engine failure is reported instead of crashing the handler', async () => {
  setPromptRunnerForTests((async () => {
    throw new Error('engine exploded');
  }) as any);

  telegramDb.upsertBinding({ userId: memberId, chatId: '900013', projectPath: PROJECT_GRANTED });

  await handleTelegramUpdate(textMessage('900013', 'сломайся'));

  assert.match(sentMessages()[0], /Прогон не удался: engine exploded/);
});
