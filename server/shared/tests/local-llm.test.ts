import assert from 'node:assert/strict';
import test from 'node:test';

import { completeJson } from '@/shared/local-llm.js';

// The local model is a best-effort helper: whatever goes wrong, callers get
// `null` and carry on. These tests swap the network for a fake fetch.

type Call = { url: string; body: Record<string, unknown> };

function fakeOllama(content: string, calls: Call[] = [], status = 200): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ message: { role: 'assistant', content }, done: true }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

test('completeJson reads JSON wrapped in a ```json block and asks the model not to think', async () => {
  const calls: Call[] = [];
  const result = await completeJson({
    system: 'sys',
    prompt: 'user text',
    model: 'qwen3:8b',
    timeoutMs: 1000,
    maxTokens: 120,
    baseUrl: 'http://ollama.test:11434/',
    fetchImpl: fakeOllama('Вот:\n```json\n{"suggestions": ["Да, давай", "Нет"]}\n```', calls),
  });

  assert.deepEqual(result, { suggestions: ['Да, давай', 'Нет'] });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('http://ollama.test:11434/'), calls[0].url);
  assert.equal(calls[0].body.model, 'qwen3:8b');
  assert.equal(calls[0].body.think, false);
  const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
  assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
  assert.equal(messages[1].content, 'user text');
});

test('completeJson gives up after timeoutMs and returns null', async () => {
  // A model that never answers unless the request is aborted.
  const hanging = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;

  const startedAt = Date.now();
  const result = await completeJson({
    system: 's', prompt: 'p', model: 'qwen3:8b', timeoutMs: 50, maxTokens: 10, fetchImpl: hanging,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result, null);
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('completeJson returns null for a refused connection, an HTTP error and non-JSON text', async () => {
  const base = { system: 's', prompt: 'p', model: 'qwen3:8b', timeoutMs: 1000, maxTokens: 10 };
  const refused = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  assert.equal(await completeJson({ ...base, fetchImpl: refused }), null);
  assert.equal(await completeJson({ ...base, fetchImpl: fakeOllama('{"a":1}', [], 500) }), null);
  assert.equal(await completeJson({ ...base, fetchImpl: fakeOllama('Не знаю, что ответить.') }), null);
});

test('completeJson passes a context window to Ollama only when asked (long transcripts)', async () => {
  const calls: Call[] = [];
  const base = { system: 's', prompt: 'p', model: 'm', timeoutMs: 1000, maxTokens: 10, baseUrl: 'http://o.test' };
  await completeJson({ ...base, fetchImpl: fakeOllama('{}', calls) });
  await completeJson({ ...base, numCtx: 32768, fetchImpl: fakeOllama('{}', calls) });
  const options = calls.map((call) => call.body.options as Record<string, unknown>);
  assert.equal('num_ctx' in options[0], false);
  assert.equal(options[1].num_ctx, 32768);
});
