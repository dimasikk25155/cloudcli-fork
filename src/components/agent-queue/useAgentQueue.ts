import { useCallback, useEffect, useState } from 'react';

import { fetchQueue, fetchQueues } from './agentQueueApi';
import { QUEUE_POLL_MS, type QueueSummary, type QueueView } from './agentQueueModel';

type Loaded<T> = { data: T; loading: boolean; error: string | null; reload: () => Promise<void>; set: (value: T) => void };

/** Опрос раз в 5 с, пока смонтирован (панель открыта); ошибка опроса не стирает прежние данные. */
function usePolled<T>(load: () => Promise<T>, initial: T): Loaded<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), QUEUE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  return { data, loading, error, reload, set: setData };
}

const EMPTY: QueueSummary[] = [];

/** Список очередей пользователя. */
export function useQueues(): Loaded<QueueSummary[]> {
  return usePolled(fetchQueues, EMPTY);
}

/** Одна очередь с пунктами. */
export function useQueue(id: string): Loaded<QueueView | null> {
  const load = useCallback(() => fetchQueue(id), [id]);
  return usePolled<QueueView | null>(load, null);
}
