import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

export function useHtmlPreview(projectId: string | undefined, path: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url: string | null; error: string | null } | null>(null);
  const key = `${projectId ?? ''}\0${path}\0${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        if (!projectId) throw new Error('Не указан проект для просмотра файла');
        const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/files/preview`, {
          method: 'POST', body: JSON.stringify({ path }), signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text() || 'Не удалось открыть превью');
        const data = await response.json();
        if (typeof data.url !== 'string' || !/^\/api\/file-preview\/[a-f0-9]+\//.test(data.url)) throw new Error('Некорректный адрес превью');
        // Check the actual document before mounting: iframe load does not distinguish HTTP errors.
        const document = await fetch(data.url, { method: 'HEAD', credentials: 'omit', signal: controller.signal });
        if (!document.ok) throw new Error('Страница недоступна. Попробуйте открыть превью заново');
        if (!controller.signal.aborted) setResult({ key, url: data.url, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, url: null, error: error instanceof Error ? error.message : 'Не удалось открыть превью' });
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, key, path, projectId]);
  return { url: result?.key === key ? result.url : null, error: result?.key === key ? result.error : null, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}
