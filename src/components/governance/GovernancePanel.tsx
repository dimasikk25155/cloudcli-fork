import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Coins, Loader2, RefreshCw, ScrollText } from 'lucide-react';

import { authenticatedFetch } from '../../utils/api';

import AuditFeedTab from './AuditFeedTab';
import SpendTab from './SpendTab';
import type { AuditEventRow, SpendSummary } from './types';

// Аудит и деньги (/api/governance). Строки живут здесь, а не в src/i18n:
// панель специфична для Neo3, а файлы локалей общие с апстримом.
//
// Порядок вкладок = порядок вопросов, которые задают утром:
// «что вообще происходило ночью» → «сколько это стоило».
// Ничего не блокируется и не запрещается — панель только показывает.

type Tab = 'feed' | 'spend';

const TABS: Array<{ id: Tab; label: string; icon: typeof ScrollText }> = [
  { id: 'feed', label: 'Лента', icon: ScrollText },
  { id: 'spend', label: 'Деньги', icon: Coins },
];

export default function GovernancePanel() {
  const [tab, setTab] = useState<Tab>('feed');
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feedResponse, spendResponse] = await Promise.all([
        authenticatedFetch('/api/governance/audit?limit=100'),
        authenticatedFetch('/api/governance/spend'),
      ]);

      if (!feedResponse.ok || !spendResponse.ok) {
        throw new Error('Сервер не отдал данные аудита');
      }

      const feedPayload = await feedResponse.json();
      const spendPayload = await spendResponse.json();

      setEvents(feedPayload?.data?.events ?? []);
      setSpend(spendPayload?.data?.spend ?? null);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить аудит');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex min-h-[34px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              tab === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}

        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex min-h-[34px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 disabled:opacity-50"
          title="Обновить"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </button>
      </div>

      {error && (
        <div className="flex flex-shrink-0 items-start gap-2 border-b border-border bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Читаю журнал…
          </div>
        ) : tab === 'feed' ? (
          <AuditFeedTab events={events} />
        ) : (
          <SpendTab spend={spend} />
        )}
      </div>
    </div>
  );
}
