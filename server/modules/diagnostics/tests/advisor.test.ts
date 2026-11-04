import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdvisor, ADVISOR_MODEL } from '@/modules/diagnostics/advisor.service.js';

function make(overrides: Record<string, unknown> = {}) {
  const runs: Array<{ prompt: string; model: string; projectPath: string }> = [];
  const advisor = createAdvisor({
    isModOn: () => true,
    canAccessSession: () => true,
    projectPathOf: () => '/p',
    fetchMessages: async () => [
      { kind: 'text', role: 'user', content: 'Почини индекс' },
      { kind: 'tool_use', role: 'assistant', content: 'скрыто' },
      { kind: 'text', role: 'assistant', content: 'Починил индекс' },
    ],
    runAgent: async (run: { prompt: string; model: string; projectPath: string }) => { runs.push(run); return { text: ' Совет: проверь миграцию ' }; },
    usageBlocked: async () => null,
    ...overrides,
  } as never);
  return { advisor, runs };
}

const ask = (advisor: ReturnType<typeof make>['advisor'], question: unknown = 'что думаешь?') =>
  advisor.ask({ user: { id: 1 }, sessionId: 's1', question });

test('advisor sends the chat tail and the question to Opus read-only and returns the answer', async () => {
  const { advisor, runs } = make();
  assert.deepEqual(await ask(advisor), { answer: 'Совет: проверь миграцию' });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].model, ADVISOR_MODEL);
  assert.equal(runs[0].projectPath, '/p');
  assert.match(runs[0].prompt, /Пользователь: Почини индекс/);
  assert.match(runs[0].prompt, /Агент: Починил индекс/);
  assert.doesNotMatch(runs[0].prompt, /скрыто/);
  assert.match(runs[0].prompt, /Вопрос: что думаешь\?/);
});

test('advisor refuses with the reason when the usage limit is reached, without calling the model', async () => {
  const { advisor, runs } = make({ usageBlocked: async () => 'лимит подписки Claude 97%, сброс в 18:00 МСК' });
  await assert.rejects(ask(advisor), (error: { code?: string; message: string }) => error.code === 'ADVISOR_LIMIT' && /97%/.test(error.message));
  assert.equal(runs.length, 0);
});

test('advisor reports a model failure in plain words', async () => {
  const { advisor } = make({ runAgent: async () => { throw new Error('network down'); } });
  await assert.rejects(ask(advisor), (error: { code?: string; message: string }) => error.code === 'ADVISOR_FAILED' && /network down/.test(error.message));
  const empty = make({ runAgent: async () => ({ text: '  ' }) }).advisor;
  await assert.rejects(ask(empty), (error: { code?: string }) => error.code === 'ADVISOR_FAILED');
});

test('advisor checks mod, question, access and allows one call at a time per chat', async () => {
  await assert.rejects(ask(make({ isModOn: () => false }).advisor), (e: { code?: string }) => e.code === 'MOD_OFF');
  await assert.rejects(ask(make().advisor, '  '), (e: { code?: string }) => e.code === 'ADVISOR_QUESTION_REQUIRED');
  await assert.rejects(ask(make({ canAccessSession: () => false }).advisor), (e: { code?: string }) => e.code === 'ADVISOR_SESSION_NOT_FOUND');

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { advisor } = make({ runAgent: async () => { await gate; return { text: 'ok' }; } });
  const first = ask(advisor);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(ask(advisor), (e: { code?: string }) => e.code === 'ADVISOR_BUSY');
  release();
  assert.deepEqual(await first, { answer: 'ok' });
});
