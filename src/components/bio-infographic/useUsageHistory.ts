import { useEffect, useState } from 'react';

import { fetchUsageHistory, type UsageHistoryDay } from '../../utils/usageHistory';

/** История расхода по дням (`GET /api/usage/history`); null — ещё грузится. */
export function useUsageHistory(): { days: UsageHistoryDay[] | null; error: string | null } {
  const [days, setDays] = useState<UsageHistoryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUsageHistory()
      .then((result) => {
        if (!cancelled) setDays(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { days, error };
}
