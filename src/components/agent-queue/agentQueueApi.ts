// Запросы панели «Конвейер» к /api/agent-queue (админ, мод modAgentQueue).

import { authenticatedFetch } from '../../utils/api';

import type { QueuePayload, QueueSummary, QueueView } from './agentQueueModel';

/** Ошибка сервера с его кодом: по коду форма находит своё поле. */
export class AgentQueueApiError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AgentQueueApiError';
    this.code = code;
  }
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authenticatedFetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    throw new AgentQueueApiError(json?.error?.message || `Запрос не прошёл (${response.status})`, json?.error?.code);
  }
  return (json?.data ?? json) as T;
}

const enc = encodeURIComponent;

export async function fetchQueues(): Promise<QueueSummary[]> {
  return (await request<{ queues: QueueSummary[] }>('/api/agent-queue')).queues;
}

export async function fetchQueue(id: string): Promise<QueueView> {
  return (await request<{ queue: QueueView }>(`/api/agent-queue/${enc(id)}`)).queue;
}

export async function createQueue(payload: QueuePayload): Promise<QueueView> {
  return (await request<{ queue: QueueView }>('/api/agent-queue', 'POST', payload)).queue;
}

export type QueueCommand = 'pause' | 'resume' | 'stop' | 'retry-rejected';

export async function runQueueCommand(id: string, command: QueueCommand): Promise<QueueView> {
  return (await request<{ queue: QueueView }>(`/api/agent-queue/${enc(id)}/${command}`, 'POST')).queue;
}

export async function markItemOk(itemId: number): Promise<QueueView> {
  return (await request<{ queue: QueueView }>(`/api/agent-queue/items/${itemId}/mark-ok`, 'POST')).queue;
}

export async function deleteQueue(id: string): Promise<void> {
  await request(`/api/agent-queue/${enc(id)}`, 'DELETE');
}
