import type { QueuedMessage } from '../../../../shared/queued-message';
import { authenticatedFetch } from '../../../utils/api';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type QueuedMessageInput = {
  content: string;
  options?: Record<string, unknown>;
  images?: unknown[];
};

const url = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/queued-message`;

async function failure(response: Response): Promise<Error> {
  let message = `HTTP ${response.status}`;
  try {
    const body = await response.json() as { error?: { message?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // no JSON body
  }
  return Object.assign(new Error(message), { status: response.status });
}

export async function fetchQueuedMessage(sessionId: string, fetcher: Fetcher = authenticatedFetch): Promise<QueuedMessage | null> {
  const response = await fetcher(url(sessionId));
  if (!response.ok) throw await failure(response);
  const body = await response.json() as { queued?: QueuedMessage | null };
  return body.queued ?? null;
}

/** `sent: true` — nothing was running, the server sent it at once (no card). */
export async function putQueuedMessage(
  sessionId: string,
  input: QueuedMessageInput,
  fetcher: Fetcher = authenticatedFetch,
): Promise<{ queued: QueuedMessage | null; sent: boolean }> {
  const response = await fetcher(url(sessionId), { method: 'PUT', body: JSON.stringify(input) });
  if (!response.ok) throw await failure(response);
  const body = await response.json() as { queued?: QueuedMessage | null; sent?: boolean };
  return { queued: body.queued ?? null, sent: body.sent === true };
}

export async function deleteQueuedMessage(sessionId: string, fetcher: Fetcher = authenticatedFetch): Promise<void> {
  const response = await fetcher(url(sessionId), { method: 'DELETE' });
  if (!response.ok) throw await failure(response);
}

export async function sendQueuedMessageNow(sessionId: string, fetcher: Fetcher = authenticatedFetch): Promise<void> {
  const response = await fetcher(`${url(sessionId)}/send-now`, { method: 'POST' });
  if (!response.ok) throw await failure(response);
}
