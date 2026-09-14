import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { requestHubPanel } from '../hub/hubPanels';
import { authenticatedFetch } from '../../utils/api';

type BotRow = { id: string; label: string; ok: boolean; detail: string };

const POLL_MS = 20_000;

export default function BotHealthButton() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    async function tick() {
      try {
        const response = await authenticatedFetch('/api/vps/bots-health');
        if (!response.ok) {
          if (!dead) setOk(false);
          return;
        }
        const json = await response.json();
        const data = json?.data ?? json;
        if (dead) return;
        const list = Array.isArray(data?.bots) ? (data.bots as BotRow[]) : [];
        setBots(list);
        setOk(Boolean(data?.ok) && list.every((b) => b.ok));
      } catch {
        if (!dead) setOk(false);
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  const hot = ok === false;
  const title =
    ok == null
      ? 'Боты: проверяю'
      : ok
        ? bots.map((b) => `${b.label}: ${b.detail}`).join('\n') || 'Боты на связи'
        : bots.filter((b) => !b.ok).map((b) => `${b.label}: ${b.detail}`).join('\n') || 'Боты не отвечают';

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => requestHubPanel('server')}
        title={title}
        aria-label={ok ? 'Боты работают' : 'Боты лежат'}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          hot
            ? 'text-rose-600 hover:bg-rose-500/15 dark:text-rose-400'
            : 'text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400'
        }`}
      >
        {hot ? <X className="h-4 w-4" strokeWidth={2.4} /> : <Check className="h-4 w-4" strokeWidth={2.4} />}
        <span
          className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${
            hot ? 'bg-rose-500' : 'bg-emerald-500'
          }`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-popover py-1.5 text-popover-foreground shadow-lg">
          <p className="px-3 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Боты
          </p>
          {bots.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">Пока нет данных</p>
          ) : (
            bots.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => requestHubPanel('server')}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
              >
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${b.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{b.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{b.detail}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
