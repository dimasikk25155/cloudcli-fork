import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modOffMessage } from '../../../../shared/mods.js';
import { createSecretRequestsService, type SecretRequestsDependencies } from '../secret-requests.service.js';

// A fake of a plausible shape; the point of most checks is that it never shows up.
const VALUE = 'sk_FakeSecretValue_0123456789abcdef';
const ADMIN = 1;
const MEMBER = 2;

type Captured = { stored: Array<{ name: string; value: string; replace: boolean }>; changes: unknown[]; notices: unknown[]; logs: string[] };

function setup(overrides: Partial<SecretRequestsDependencies> = {}, existing: string[] = []) {
  const captured: Captured = { stored: [], changes: [], notices: [], logs: [] };
  const names = new Set(existing);
  const mods = new Map<string, boolean>();
  let counter = 0;
  const service = createSecretRequestsService({
    isAdmin: (userId) => userId === ADMIN,
    isModOn: (_userId, key) => mods.get(key) ?? true,
    store: async ({ name, value, replace }) => {
      if (names.has(name) && !replace) {
        const error = new Error('Такой ключ уже есть') as Error & { code: string; statusCode: number };
        error.code = 'SECRET_EXISTS';
        error.statusCode = 409;
        throw error;
      }
      captured.stored.push({ name, value, replace });
      names.add(name);
      return { name };
    },
    exists: async (name) => names.has(name),
    sessionTitle: (sessionId) => (sessionId === 'chat-1' ? 'Samruk: страница' : null),
    onChange: (userId) => { captured.changes.push({ userId }); },
    onRequested: (request) => { captured.notices.push(request); },
    newId: () => `req-${++counter}`,
    waitMs: 2_000,
    ...overrides,
  });
  return { service, captured, mods };
}

/** Everything console prints while `run` works, so a test can check the value never went to a log. */
async function captureConsole<T>(logs: string[], run: () => Promise<T>): Promise<T> {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((method) => console[method]);
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { logs.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg))).join(' ')); };
  }
  try {
    return await run();
  } finally {
    methods.forEach((method, index) => { console[method] = saved[index]; });
  }
}

const until = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never became true');
};

describe('secret requests', () => {
  it('the agent waits, Dima saves: the value goes only to the store; tool answer, list, frames, notices and logs never carry it', async () => {
    const { service, captured } = setup();
    const outcome = await captureConsole(captured.logs, async () => {
      const waiting = service.request(ADMIN, 'chat-1', { name: 'FB_PAGE_TOKEN', why: 'постинг на страницу Samruk' });
      await until(async () => (await service.list(ADMIN)).length === 1);
      const [card] = await service.list(ADMIN);
      assert.deepEqual(
        { ...card, createdAt: typeof card.createdAt },
        { id: 'req-1', sessionId: 'chat-1', sessionTitle: 'Samruk: страница', name: 'FB_PAGE_TOKEN', why: 'постинг на страницу Samruk', createdAt: 'string', exists: false },
      );
      const saved = await service.answer(ADMIN, card.id, { value: VALUE });
      assert.deepEqual(saved, { name: 'FB_PAGE_TOKEN', message: 'FB_PAGE_TOKEN сохранён в файле секретов' });
      assert.equal(JSON.stringify(saved).includes(VALUE), false);
      return waiting;
    });

    assert.equal(outcome.status, 'saved');
    assert.equal(outcome.message, 'FB_PAGE_TOKEN сохранён в файле секретов');
    assert.deepEqual(captured.stored, [{ name: 'FB_PAGE_TOKEN', value: VALUE, replace: false }]);
    assert.deepEqual(await service.list(ADMIN), []);
    assert.equal(captured.changes.length, 2, 'one frame for the new card, one for its answer');
    assert.equal(captured.notices.length, 1);
    for (const [where, data] of Object.entries({ outcome, changes: captured.changes, notices: captured.notices, logs: captured.logs })) {
      assert.equal(JSON.stringify(data).includes(VALUE), false, `the value leaked into ${where}`);
    }
    assert.deepEqual(captured.changes[0], { userId: ADMIN });
  });

  it('no answer in time: «спроси позже», the card stays; asking again later gets the answer given meanwhile, without a second card', async () => {
    const { service, captured } = setup({ waitMs: 20 });
    const first = await service.request(ADMIN, 'chat-1', { name: 'KIE_KEY', why: 'генерация' });
    assert.equal(first.status, 'pending');
    assert.equal(first.message, 'Дима пока не ответил — спроси позже');
    const [card] = await service.list(ADMIN);
    assert.equal(card.name, 'KIE_KEY');

    await service.answer(ADMIN, card.id, { value: VALUE });
    const again = await service.request(ADMIN, 'chat-1', { name: 'KIE_KEY', why: 'генерация' });
    assert.equal(again.status, 'saved');
    assert.equal(again.message, 'KIE_KEY сохранён в файле секретов');
    assert.equal(captured.notices.length, 1, 'asking again is the same request');
    assert.equal(JSON.stringify(again).includes(VALUE), false);
  });

  it('asking again while the card is open joins it: both calls get one answer', async () => {
    const { service, captured } = setup();
    const one = service.request(ADMIN, 'chat-1', { name: 'API_TOKEN', why: 'раз' });
    const two = service.request(ADMIN, 'chat-1', { name: 'API_TOKEN', why: 'два' });
    await until(async () => (await service.list(ADMIN)).length === 1);
    service.decline(ADMIN, (await service.list(ADMIN))[0].id);
    assert.deepEqual((await Promise.all([one, two])).map((outcome) => outcome.message), ['Дима отказал', 'Дима отказал']);
    assert.equal(captured.notices.length, 1);
  });

  it('decline answers «Дима отказал» and removes the card', async () => {
    const { service } = setup();
    const waiting = service.request(ADMIN, 'chat-1', { name: 'SAMRUK_TOKEN', why: 'нужен' });
    await until(async () => (await service.list(ADMIN)).length === 1);
    assert.deepEqual(service.decline(ADMIN, 'req-1'), { message: 'Дима отказал' });
    const outcome = await waiting;
    assert.equal(outcome.status, 'declined');
    assert.equal(outcome.message, 'Дима отказал');
    assert.deepEqual(await service.list(ADMIN), []);
  });

  it('an existing name without «заменить» is refused «такой ключ уже есть» and the card stays; with replace it is overwritten', async () => {
    const { service, captured } = setup({}, ['GITHUB_TOKEN']);
    const waiting = service.request(ADMIN, 'chat-1', { name: 'GITHUB_TOKEN', why: 'пуш' });
    await until(async () => (await service.list(ADMIN)).length === 1);
    assert.equal((await service.list(ADMIN))[0].exists, true);
    await captureConsole(captured.logs, async () => {
      await assert.rejects(
        service.answer(ADMIN, 'req-1', { value: VALUE }),
        (error: Error & { code?: string; statusCode?: number }) =>
          error.code === 'SECRET_EXISTS' && error.statusCode === 409 && /такой ключ уже есть/i.test(error.message) && !error.message.includes(VALUE),
      );
    });
    assert.equal((await service.list(ADMIN)).length, 1);
    await service.answer(ADMIN, 'req-1', { value: VALUE, replace: true });
    assert.equal((await waiting).status, 'saved');
    assert.deepEqual(captured.stored, [{ name: 'GITHUB_TOKEN', value: VALUE, replace: true }]);
    assert.equal(captured.logs.join('\n').includes(VALUE), false);
  });

  it('a store failure never echoes the value: fixed text, nothing in the log', async () => {
    const logs: string[] = [];
    const { service } = setup({ store: async ({ value }) => { throw new Error(`disk full while writing ${value}`); } });
    void service.request(ADMIN, 'chat-1', { name: 'BROKEN_KEY', why: 'проверка' });
    await until(async () => (await service.list(ADMIN)).length === 1);
    await captureConsole(logs, async () => {
      await assert.rejects(service.answer(ADMIN, 'req-1', { value: VALUE }), (error: Error) => !error.message.includes(VALUE) && !String(error.stack).includes(VALUE));
    });
    assert.equal(logs.join('\n').includes(VALUE), false);
    service.decline(ADMIN, 'req-1');
  });

  it('name must match ^[A-Z][A-Z0-9_]{2,63}$ and why is required', async () => {
    const { service } = setup();
    for (const name of ['lower_key', 'AB', '1ABC', 'A-B-C', `A${'B'.repeat(64)}`, '']) {
      await assert.rejects(service.request(ADMIN, 'chat-1', { name, why: 'x' }), (error: { code?: string; statusCode?: number }) => error.code === 'SECRET_NAME_INVALID' && error.statusCode === 400);
    }
    await assert.rejects(service.request(ADMIN, 'chat-1', { name: 'GOOD_NAME', why: '  ' }), (error: { code?: string }) => error.code === 'SECRET_WHY_REQUIRED');
    assert.deepEqual(await service.list(ADMIN), []);
  });

  it('a teammate is refused everywhere; the switched-off mod answers with its text', async () => {
    const { service, mods } = setup();
    await assert.rejects(service.request(MEMBER, 'chat-2', { name: 'GOOD_NAME', why: 'x' }), (error: { statusCode?: number }) => error.statusCode === 403);
    await assert.rejects(service.list(MEMBER), (error: { statusCode?: number }) => error.statusCode === 403);
    await assert.rejects(service.answer(MEMBER, 'req-1', { value: VALUE }), (error: { statusCode?: number }) => error.statusCode === 403);
    assert.throws(() => service.decline(MEMBER, 'req-1'), (error: { statusCode?: number }) => error.statusCode === 403);

    mods.set('modSecretRequest', false);
    await assert.rejects(
      service.request(ADMIN, 'chat-1', { name: 'GOOD_NAME', why: 'x' }),
      (error: { code?: string; message: string }) => error.code === 'MOD_OFF' && error.message === modOffMessage('modSecretRequest'),
    );
    await assert.rejects(service.list(ADMIN), (error: { code?: string }) => error.code === 'MOD_OFF');
  });

  it('«Ждут тебя» switched off: secret.request is refused at once with the mod-off text instead of hanging with no card to answer', async () => {
    const { service, mods, captured } = setup({ waitMs: 60_000 });
    mods.set('modAttention', false);
    const started = Date.now();
    await assert.rejects(
      service.request(ADMIN, 'chat-1', { name: 'GOOD_NAME', why: 'x' }),
      (error: { code?: string; message: string }) => error.code === 'MOD_OFF' && error.message === modOffMessage('modSecretRequest'),
    );
    assert.ok(Date.now() - started < 1_000, 'answered right away, not after the wait');
    assert.deepEqual(captured.notices, [], 'no push for a card nobody can see');
    await assert.rejects(service.list(ADMIN), (error: { code?: string }) => error.code === 'MOD_OFF');
  });

  it('an unknown or foreign request id is «нет такого запроса»', async () => {
    const { service } = setup({ isAdmin: () => true });
    void service.request(ADMIN, 'chat-1', { name: 'OWN_KEY', why: 'x' });
    await until(async () => (await service.list(ADMIN)).length === 1);
    await assert.rejects(service.answer(3, 'req-1', { value: VALUE }), (error: { statusCode?: number }) => error.statusCode === 404);
    assert.throws(() => service.decline(ADMIN, 'nope'), (error: { statusCode?: number }) => error.statusCode === 404);
    await assert.rejects(service.answer(ADMIN, 'req-1', { value: '   ' }), (error: { code?: string }) => error.code === 'SECRET_VALUE_EMPTY');
    service.decline(ADMIN, 'req-1');
  });
});

describe('secret request push', () => {
  it('«Агент просит ключ NAME» with the reason, opening «Ждут тебя»; nothing else goes in', async () => {
    const { secretRequestPushPayload } = await import('../secret-requests.runtime.js');
    const payload = secretRequestPushPayload({ userId: ADMIN, id: 'req-9', sessionId: 'chat-1', name: 'FB_PAGE_TOKEN', why: 'постинг Samruk' });
    assert.equal(payload.title, 'Агент просит ключ FB_PAGE_TOKEN');
    assert.match(payload.body, /^постинг Samruk/);
    assert.deepEqual(payload.data, { code: 'secret.request', tag: 'secret:req-9', panel: 'attention', urlPath: '/?panel=attention', provider: 'system' });
  });
});
