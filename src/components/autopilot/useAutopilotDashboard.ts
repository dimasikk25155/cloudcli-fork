import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../utils/api';

export type AutopilotDashboard = {
  available: boolean;
  url: string | null;
  title: string | null;
  finished: boolean;
};

const EMPTY: AutopilotDashboard = { available: false, url: null, title: null, finished: false };

// Пока сборка не началась, `.autopilot/` в проекте нет — папку создаёт агент
// в первой же фазе, посреди разговора. Одной проверки при открытии проекта не
// хватило бы: вкладка появилась бы только после переключения проекта, то есть
// ровно тогда, когда смотреть уже нечего. Поэтому опрос.
const POLL_MS = 15000;

/** Есть ли в проекте прогон автопилота и по какой ссылке его показывать. */
export function useAutopilotDashboard(projectId: string | undefined): AutopilotDashboard {
  const [state, setState] = useState<AutopilotDashboard>(EMPTY);

  // Ссылка подписана на 12 часов, и менять её на каждом опросе незачем: смена
  // src перезагружает iframe, а вместе с ним и прокрутку дашборда.
  const urlRef = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!projectId) {
      urlRef.current = null;
      setState(EMPTY);
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/autopilot/status`);
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.available) {
        urlRef.current = null;
        setState(EMPTY);
        return;
      }

      if (!urlRef.current) urlRef.current = data.url ?? null;
      setState({
        available: true,
        url: urlRef.current,
        title: data.title ?? null,
        finished: Boolean(data.finished),
      });
    } catch {
      // Сеть моргнула — прошлое состояние честнее, чем «прогона нет».
    }
  }, [projectId]);

  useEffect(() => {
    urlRef.current = null;
    setState(EMPTY);
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check]);

  return state;
}
