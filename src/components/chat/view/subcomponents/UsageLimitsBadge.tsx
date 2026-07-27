import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GaugeIcon } from 'lucide-react';

import {
  formatResetMoscow,
  getUsageLimits,
  refreshUsageLimits,
  subscribeUsageLimits,
} from '../../../../utils/usageLimits';

const POLL_INTERVAL_MS = 60_000;

function pctTone(pct: number | null): string {
  if (pct === null) {
    return 'text-muted-foreground';
  }
  if (pct >= 90) {
    return 'text-red-500';
  }
  if (pct >= 70) {
    return 'text-amber-500';
  }
  return 'text-foreground';
}

function pctLabel(pct: number | null): string {
  return pct === null ? '—' : `${Math.round(pct)}%`;
}

/** Kimi models run either through the Claude provider (kimi-k3 etc.) or the
 * native Kimi engine (kimi-code/k3) — both carry "kimi" in the model id. */
function isKimiModel(model: string | undefined): boolean {
  return (model ?? '').toLowerCase().includes('kimi');
}

type Props = {
  /** Currently selected model id — decides which subscription's limits to show. */
  model?: string;
};

/**
 * Compact subscription-limits badge for the composer toolbar: "5ч 16% · 7д 36%"
 * ("4ч …" for Kimi — its rolling window is 4 hours, not 5).
 * Shows only the subscription that matches the selected model — Kimi limits when
 * a Kimi model is active, Claude limits otherwise — so it stays narrow instead
 * of stacking both. Polls /api/usage/limits once a minute; tapping it opens a
 * small panel with reset times (Moscow) and the run-guard threshold.
 */
export default function UsageLimitsBadge({ model }: Props) {
  const usage = useSyncExternalStore(subscribeUsageLimits, getUsageLimits, getUsageLimits);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    refreshUsageLimits();
    const timer = setInterval(refreshUsageLimits, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const kimi = isKimiModel(model);

  const fiveHourPct = kimi ? (usage?.kimiFiveHourPct ?? null) : (usage?.fiveHourPct ?? null);
  const sevenDayPct = kimi ? (usage?.kimiSevenDayPct ?? null) : (usage?.sevenDayPct ?? null);
  const fiveHourResetsAt = kimi ? (usage?.kimiFiveHourResetsAt ?? null) : (usage?.fiveHourResetsAt ?? null);
  const sevenDayResetsAt = kimi ? (usage?.kimiSevenDayResetsAt ?? null) : (usage?.sevenDayResetsAt ?? null);

  const subLabel = kimi ? 'Kimi' : 'Claude';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
        title={`Лимиты подписки ${subLabel}`}
        aria-label={`Показать лимиты подписки ${subLabel}`}
      >
        <span className="composer-chip-icon grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
          <GaugeIcon className="h-3.5 w-3.5" />
        </span>
        <span className={`font-medium ${pctTone(fiveHourPct)}`}>{kimi ? '4ч' : '5ч'} {pctLabel(fiveHourPct)}</span>
        <span className={`hidden font-medium sm:inline ${pctTone(sevenDayPct)}`}>· 7д {pctLabel(sevenDayPct)}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
          <div className="mb-2 font-semibold">Лимиты подписки {subLabel}</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{kimi ? '4-часовое окно' : '5-часовое окно'}</span>
              <span className={`font-medium ${pctTone(fiveHourPct)}`}>{pctLabel(fiveHourPct)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">сброс</span>
              <span>{formatResetMoscow(fiveHourResetsAt)}</span>
            </div>
            <div className="my-1.5 border-t border-border/60" />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Неделя (7 дней)</span>
              <span className={`font-medium ${pctTone(sevenDayPct)}`}>{pctLabel(sevenDayPct)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">сброс</span>
              <span>{formatResetMoscow(sevenDayResetsAt, true)}</span>
            </div>
            <div className="my-1.5 border-t border-border/60" />
            <div className="text-muted-foreground">
              {kimi
                ? 'Отдельная подписка Kimi Code — модели Kimi не тратят лимит Claude. Показаны лимиты активной модели.'
                : `При ≥${usage?.threshold ?? 90}% пятичасового окна новые прогоны придерживаются — остаток зарезервирован под личные вопросы. Обновляется раз в минуту.`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
