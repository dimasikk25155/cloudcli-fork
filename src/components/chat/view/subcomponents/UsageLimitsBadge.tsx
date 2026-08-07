import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GaugeIcon } from 'lucide-react';

import {
  formatResetMoscow,
  getUsageLimits,
  refreshUsageLimits,
  subscribeUsageLimits,
} from '../../../../utils/usageLimits';

const POLL_INTERVAL_MS = 60_000;

/** Official usage page of the Claude subscription — the badge links straight to it. */
const CLAUDE_USAGE_URL = 'https://claude.ai/new#settings/usage';

const CHIP_CLASS =
  'composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5';

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

/** Local models run on our own GPU and consume no subscription at all, so the
 * badge must not show Claude's percentages next to them — that would read as
 * "you are burning your Max limit" when nothing is being spent. */
function isLocalModel(model: string | undefined): boolean {
  return (model ?? '').startsWith('local-');
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
 * of stacking both. Polls /api/usage/limits once a minute.
 * On Claude it is a link to the official usage page (reset times live in the
 * hover tooltip); on Kimi — which has no such page — tapping still opens the
 * local panel with reset times (Moscow).
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

  if (isLocalModel(model)) {
    return (
      <span
        className={CHIP_CLASS}
        title="Локальная модель на своей видеокарте — подписка не расходуется"
        aria-label="Локальная модель — лимиты подписки не расходуются"
      >
        <span className="composer-chip-icon grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
          <GaugeIcon className="h-3.5 w-3.5" />
        </span>
        <span className="font-medium">Локально · без лимита</span>
      </span>
    );
  }

  const kimi = isKimiModel(model);

  const fiveHourPct = kimi ? (usage?.kimiFiveHourPct ?? null) : (usage?.fiveHourPct ?? null);
  const sevenDayPct = kimi ? (usage?.kimiSevenDayPct ?? null) : (usage?.sevenDayPct ?? null);
  const fiveHourResetsAt = kimi ? (usage?.kimiFiveHourResetsAt ?? null) : (usage?.fiveHourResetsAt ?? null);
  const sevenDayResetsAt = kimi ? (usage?.kimiSevenDayResetsAt ?? null) : (usage?.sevenDayResetsAt ?? null);

  const chipBody = (
    <>
      <span className="composer-chip-icon grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        <GaugeIcon className="h-3.5 w-3.5" />
      </span>
      <span className={`font-medium ${pctTone(fiveHourPct)}`}>{kimi ? '4ч' : '5ч'} {pctLabel(fiveHourPct)}</span>
      <span className={`hidden font-medium sm:inline ${pctTone(sevenDayPct)}`}>· 7д {pctLabel(sevenDayPct)}</span>
    </>
  );

  if (!kimi) {
    const tooltip = [
      'Лимиты подписки Claude — открыть на claude.ai',
      `5-часовое окно: ${pctLabel(fiveHourPct)}, сброс ${formatResetMoscow(fiveHourResetsAt)}`,
      `Неделя (7 дней): ${pctLabel(sevenDayPct)}, сброс ${formatResetMoscow(sevenDayResetsAt, true)}`,
      `При ≥${usage?.threshold ?? 90}% пятичасового окна новые прогоны придерживаются — остаток зарезервирован под личные вопросы.`,
    ].join('\n');

    return (
      <a
        href={CLAUDE_USAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={CHIP_CLASS}
        title={tooltip}
        aria-label="Лимиты подписки Claude — открыть страницу расхода на claude.ai"
      >
        {chipBody}
      </a>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={CHIP_CLASS}
        title="Лимиты подписки Kimi"
        aria-label="Показать лимиты подписки Kimi"
      >
        {chipBody}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
          <div className="mb-2 font-semibold">Лимиты подписки Kimi</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">4-часовое окно</span>
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
              Отдельная подписка Kimi Code — модели Kimi не тратят лимит Claude. Показаны лимиты активной модели.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
