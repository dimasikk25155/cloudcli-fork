// Запросы мастер-сессии к /api/master-session (мод modSessionHub).

import { authenticatedFetch } from '../../utils/api';

import type { MasterDraft, MasterQuestion, MasterSendItem, MasterSendResult } from './masterSessionModel';

async function request<T>(url: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await authenticatedFetch(url, init
    ? { method: init.method, body: JSON.stringify(init.body) }
    : undefined);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Запрос не прошёл (${response.status})`);
  }
  return (payload?.data ?? payload) as T;
}

export async function fetchMasterQuestions(): Promise<MasterQuestion[]> {
  const data = await request<{ questions?: MasterQuestion[] }>('/api/master-session/questions');
  return Array.isArray(data?.questions) ? data.questions : [];
}

export async function prepareMasterDrafts(sessionIds: string[]): Promise<MasterDraft[]> {
  const data = await request<{ drafts?: MasterDraft[] }>('/api/master-session/drafts', { method: 'POST', body: { sessionIds } });
  return Array.isArray(data?.drafts) ? data.drafts : [];
}

export async function sendMasterAnswers(batchId: string, items: MasterSendItem[]): Promise<MasterSendResult[]> {
  const data = await request<{ results?: MasterSendResult[] }>('/api/master-session/send', { method: 'POST', body: { batchId, items } });
  return Array.isArray(data?.results) ? data.results : [];
}
