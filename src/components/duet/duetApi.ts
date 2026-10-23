// Запросы окна «Дуэт» к /api/duet (админ, мод modDuet).

import { authenticatedFetch } from '../../utils/api';
import { readJson } from '../server/shared';

import type { DuetChoice, DuetSettings, DuetStateResponse } from './duetModel';

async function send(url: string, method: 'POST' | 'PUT', body?: unknown) {
  const response = await authenticatedFetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Запрос не прошёл (${response.status})`);
  return data?.data ?? data;
}

export function fetchDuetState(): Promise<DuetStateResponse> {
  return readJson('/api/duet/state') as Promise<DuetStateResponse>;
}

export function checkNow(): Promise<DuetStateResponse> {
  return send('/api/duet/check', 'POST') as Promise<DuetStateResponse>;
}

export function decide(decisionId: string, choice: DuetChoice) {
  return send(`/api/duet/decisions/${encodeURIComponent(decisionId)}/${choice}`, 'POST');
}

export function takeIdea(ideaId: string) {
  return send(`/api/duet/ideas/${encodeURIComponent(ideaId)}/take`, 'POST');
}

export function dismissIdea(ideaId: string) {
  return send(`/api/duet/ideas/${encodeURIComponent(ideaId)}/dismiss`, 'POST');
}

export function sweepIdeas(serviceId?: string): Promise<{ queued: boolean }> {
  return send('/api/duet/ideas/sweep', 'POST', serviceId ? { serviceId } : {});
}

export type DuetSettingsPatch = Partial<Pick<DuetSettings, 'briefTime' | 'checkEveryMin' | 'ideasEveryDays'>> & {
  mute?: string;
  unmute?: string;
  project?: { serviceId: string; path: string | null };
};

export function saveSettings(patch: DuetSettingsPatch): Promise<{ settings: DuetSettings }> {
  return send('/api/duet/settings', 'PUT', patch);
}
