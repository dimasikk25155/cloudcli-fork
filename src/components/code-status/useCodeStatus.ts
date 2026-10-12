import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';

import type { CodeStatus } from './codeStatusView';

/** Сервер сам держит ответ 60 с; чаще спрашивать бессмысленно. */
const POLL_MS = 60_000;

export type CodeStatusState = {
  status: CodeStatus | null;
  loading: boolean;
  /** Последний запрос не удался (сеть, 403). Прежние данные остаются. */
  failed: boolean;
  refresh: () => void;
};

export function useCodeStatus(projectId: string | null | undefined): CodeStatusState {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      if (!projectId) return;
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const query = force ? '?refresh=1' : '';
        const response = await authenticatedFetch(
          `/api/projects/${encodeURIComponent(projectId)}/code-status${query}`,
        );
        if (request !== requestRef.current) return;
        if (!response.ok) {
          setFailed(true);
          if (response.status === 403 || response.status === 404) setStatus(null);
          return;
        }
        setStatus((await response.json()) as CodeStatus);
        setFailed(false);
      } catch {
        if (request === requestRef.current) setFailed(true);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setStatus(null);
    setFailed(false);
    if (!projectId) return undefined;
    void load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, POLL_MS);
    const onFocus = () => void load(false);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      requestRef.current += 1;
    };
  }, [projectId, load]);

  const refresh = useCallback(() => void load(true), [load]);

  return { status, loading, failed, refresh };
}
