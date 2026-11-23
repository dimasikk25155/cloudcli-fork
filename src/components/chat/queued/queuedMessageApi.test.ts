import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteQueuedMessage, fetchQueuedMessage, putQueuedMessage, sendQueuedMessageNow } from './queuedMessageApi.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('the four calls hit the contract routes with the right verbs', async () => {
  const calls: Array<[string, string | undefined, string | undefined]> = [];
  const fetcher = async (u: string, init?: RequestInit) => {
    calls.push([u, init?.method, init?.body as string | undefined]);
    return json({ queued: null, sent: true, ok: true });
  };
  await fetchQueuedMessage('a b', fetcher);
  const put = await putQueuedMessage('s1', { content: 'Привет', options: { m: 1 } }, fetcher);
  await deleteQueuedMessage('s1', fetcher);
  await sendQueuedMessageNow('s1', fetcher);

  assert.deepEqual(calls, [
    ['/api/sessions/a%20b/queued-message', undefined, undefined],
    ['/api/sessions/s1/queued-message', 'PUT', JSON.stringify({ content: 'Привет', options: { m: 1 } })],
    ['/api/sessions/s1/queued-message', 'DELETE', undefined],
    ['/api/sessions/s1/queued-message/send-now', 'POST', undefined],
  ]);
  assert.equal(put.sent, true);
});

test('a server refusal surfaces its message and status', async () => {
  const fetcher = async () => json({ success: false, error: { code: 'QUEUED_MESSAGE_EMPTY', message: 'Пусто' } }, 400);
  await assert.rejects(putQueuedMessage('s1', { content: '' }, fetcher), (e: Error & { status?: number }) => e.message === 'Пусто' && e.status === 400);
});
