import { useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '../../auth';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../../utils/api';
import { useModEnabled } from '../../../hooks/useModEnabled';

import { createSecretRequestsStore, type SecretRequest, type SecretRequestsSnapshot } from './secretRequestsStore';

/** Safety-net poll while the feature is on (a missed WS frame). */
const SECRET_REQUESTS_POLL_MS = 60_000;
/** Content-free «re-read» frame from `server/modules/secret-requests`. Not a chat row. */
const SECRET_REQUESTS_CHANGED = 'secret_requests_changed';

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === 'string' && payload.error.message) {
      return new Error(payload.error.message);
    }
  } catch {
    // Not JSON — use the fallback.
  }
  return new Error(fallback);
}

export const secretRequestsStore = createSecretRequestsStore({
  async fetchList() {
    const response = await authenticatedFetch('/api/secret-requests');
    if (!response.ok) throw await errorFrom(response, 'Не удалось загрузить запросы ключей');
    const payload = (await response.json()) as { data?: { requests?: unknown } };
    return Array.isArray(payload.data?.requests) ? (payload.data.requests as SecretRequest[]) : [];
  },
  async postAnswer(id, body) {
    const response = await authenticatedFetch(`/api/secret-requests/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await errorFrom(response, 'Не получилось сохранить ключ');
    const payload = (await response.json()) as { data: { name: string; message: string } };
    return payload.data;
  },
  async postDecline(id) {
    const response = await authenticatedFetch(`/api/secret-requests/${encodeURIComponent(id)}/decline`, { method: 'POST' });
    if (!response.ok) throw await errorFrom(response, 'Не получилось отказать');
  },
});

const subscribeStore = (listener: () => void) => secretRequestsStore.subscribe(listener);
const readSnapshot = (): SecretRequestsSnapshot => secretRequestsStore.getSnapshot();
const EMPTY: SecretRequestsSnapshot = { entries: [], lastMessage: null, loaded: false };
const readEmpty = () => EMPTY;
const subscribeNothing = () => () => {};

/**
 * Open key requests of agents. Admin-only and switchable («Запрос ключа»):
 * for anyone else it is an empty list and nothing is fetched.
 */
export function useSecretRequests() {
  const { user } = useAuth();
  const featureOn = useModEnabled('modSecretRequest');
  const active = user?.role === 'admin' && featureOn;
  const { subscribe } = useWebSocket();
  const snapshot = useSyncExternalStore(
    active ? subscribeStore : subscribeNothing,
    active ? readSnapshot : readEmpty,
    active ? readSnapshot : readEmpty,
  );

  useEffect(() => {
    if (!active) return undefined;
    void secretRequestsStore.refresh();
    const unsubscribe = subscribe((event: ServerEvent) => {
      if (event.kind === SECRET_REQUESTS_CHANGED || event.kind === 'websocket_reconnected') {
        void secretRequestsStore.refresh();
      }
    });
    const interval = window.setInterval(() => void secretRequestsStore.refresh(), SECRET_REQUESTS_POLL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [active, subscribe]);

  return snapshot;
}
