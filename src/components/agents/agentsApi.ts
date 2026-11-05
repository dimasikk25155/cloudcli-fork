// Запросы панели «Агенты» к /api/agents (админ, мод modAgents).

import { authenticatedFetch } from '../../utils/api';
import type { ProviderModelsDefinition } from '../../types/app';

import type { AgentItem, AgentPayload, AgentProvider, AgentRules } from './agentsModel';

/** Ошибка сервера с его кодом: по коду форма находит своё поле. */
export class AgentsApiError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AgentsApiError';
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
    throw new AgentsApiError(json?.error?.message || `Запрос не прошёл (${response.status})`, json?.error?.code);
  }
  return (json?.data ?? json) as T;
}

const enc = encodeURIComponent;

export async function fetchAgents(): Promise<AgentItem[]> {
  return (await request<{ agents: AgentItem[] }>('/api/agents')).agents;
}

export async function createAgent(payload: AgentPayload): Promise<AgentItem> {
  return (await request<{ agent: AgentItem }>('/api/agents', 'POST', payload)).agent;
}

export async function updateAgent(id: string, payload: AgentPayload): Promise<AgentItem> {
  return (await request<{ agent: AgentItem }>(`/api/agents/${enc(id)}`, 'PUT', payload)).agent;
}

export async function deleteAgent(id: string): Promise<void> {
  await request(`/api/agents/${enc(id)}`, 'DELETE');
}

export function fetchRules(id: string): Promise<AgentRules> {
  return request<AgentRules>(`/api/agents/${enc(id)}/rules`);
}

export function addRule(id: string, text: string): Promise<AgentRules> {
  return request<AgentRules>(`/api/agents/${enc(id)}/rules`, 'POST', { text });
}

export function removeRule(id: string, ruleId: number): Promise<AgentRules> {
  return request<AgentRules>(`/api/agents/${enc(id)}/rules/${ruleId}`, 'DELETE');
}

export async function startChat(id: string, task: string): Promise<string> {
  return (await request<{ sessionId: string }>(`/api/agents/${enc(id)}/chat`, 'POST', { task })).sessionId;
}

export type ProjectOption = { fullPath: string; displayName: string };

export async function fetchProjects(): Promise<ProjectOption[]> {
  // skipSync: список нужен только для выпадающего списка, пересканировать проекты незачем.
  const response = await authenticatedFetch('/api/projects?skipSync=1');
  const list: unknown = response.ok ? await response.json() : [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is ProjectOption => Boolean(item && typeof item.fullPath === 'string'))
    .map((item) => ({ fullPath: item.fullPath, displayName: item.displayName || item.fullPath }));
}

export async function fetchModelCatalog(provider: AgentProvider): Promise<ProviderModelsDefinition | null> {
  try {
    const response = await authenticatedFetch(`/api/providers/${provider}/models`);
    const json = await response.json();
    return (json?.data?.models as ProviderModelsDefinition | undefined) ?? null;
  } catch {
    return null;
  }
}
