import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchDuetState } from './duetApi';
import { pollDelayMs, type DuetStateResponse } from './duetModel';

/**
 * Состояние Дуэта с опросом. Панель опрашивает часто (пока Дуэт работает —
 * раз в 4 с), хаб «Ждут тебя» — раз в минуту. Вкладка в фоне — пауза.
 */
export function useDuetState(active: boolean, mode: 'panel' | 'hub' = 'panel') {
  const [state, setState] = useState<DuetStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const timer = useRef<number | null>(null);
  const latest = useRef<DuetStateResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDuetState();
      if (!mounted.current) return;
      latest.current = next;
      setState(next);
      setError(null);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const apply = useCallback((next: DuetStateResponse) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active) return () => {
      mounted.current = false;
    };
    const loop = async () => {
      if (typeof document === 'undefined' || !document.hidden) await refresh();
      if (!mounted.current) return;
      const delay = mode === 'hub' ? 60_000 : pollDelayMs(latest.current);
      timer.current = window.setTimeout(() => void loop(), delay);
    };
    void loop();
    return () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [active, mode, refresh]);

  return { state, error, refresh, apply };
}
