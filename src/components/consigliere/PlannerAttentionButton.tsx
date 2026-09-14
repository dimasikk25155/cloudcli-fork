import { Bell } from 'lucide-react';
import { useState } from 'react';

import { requestHubPanel } from '../hub/hubPanels';
import { usePlannerAttention } from './usePlannerAttention';

export function CountDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 z-[2] flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? '9+' : count}
    </span>
  );
}

export default function PlannerAttentionButton() {
  const { items } = usePlannerAttention();
  const [open, setOpen] = useState(false);
  const count = items.length;
  const hot = count > 0;

  function openPlanner() {
    setOpen(false);
    requestHubPanel('consigliere');
  }

  const summary = hot
    ? items.map((item) => item.label).join('\n')
    : 'В ближайшие три дня чисто';

  return (
    <div
      className="relative flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={openPlanner}
        title={summary}
        aria-label={hot ? `Канцелярия: ${count} на глазах` : 'Канцелярия: всё чисто'}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          hot
            ? 'text-rose-600 hover:bg-rose-500/15 dark:text-rose-400'
            : 'text-foreground/70 hover:bg-accent hover:text-foreground'
        }`}
      >
        <Bell className="h-4 w-4" strokeWidth={hot ? 2.4 : 1.8} />
        <CountDot count={count} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-popover py-1.5 text-popover-foreground shadow-lg">
          <p className="px-3 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {hot ? '3 дня и просроченное' : 'Чисто'}
          </p>
          {hot ? (
            items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={openPlanner}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent"
              >
                <span className="text-sm text-foreground">{item.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {item.kind === 'sub' ? 'Подписка' : 'Событие'}
                  {item.detail ? ` · ${item.detail}` : ''}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">В ближайшие три дня ничего не горит.</p>
          )}
        </div>
      )}
    </div>
  );
}
