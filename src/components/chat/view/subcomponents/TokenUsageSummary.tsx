import { ActivityIcon } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Mini chip: session spend (input+output including cache) plus how full the
 * model's context window is. Those are different numbers — never write spend
 * over the window or Grok's 3M-token turns render as "600%".
 */
export default function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const spendTokens = inputTokens + outputTokens;
  // `used` is the live context-window fill. Do NOT fall back to spend:
  // on Grok that sum is every model call in the turn (millions).
  const usedTokens = readUsageNumber(usage?.used);
  const windowTokens = readUsageNumber(usage?.total);

  const hasWindow = windowTokens > 0;
  const hasFill = usedTokens > 0;
  const hasSpend = spendTokens > 0;
  const fillPct = hasWindow && hasFill
    ? Math.min(100, Math.round((usedTokens / windowTokens) * 100))
    : null;

  // Colour tracks headroom: calm under 60%, warning past 60%, urgent past 85%.
  const fillTone =
    fillPct === null || fillPct < 60
      ? 'text-muted-foreground'
      : fillPct < 85
        ? 'text-amber-500'
        : 'text-red-500';
  const iconTone =
    fillPct === null || fillPct < 60
      ? 'bg-primary/10 text-primary'
      : fillPct < 85
        ? 'bg-amber-500/10 text-amber-500'
        : 'bg-red-500/10 text-red-500';

  const title = hasSpend || hasFill
    ? [
        hasSpend
          ? `В этой сессии: ${spendTokens.toLocaleString()} токенов (вход ${inputTokens.toLocaleString()} · выход ${outputTokens.toLocaleString()})`
          : null,
        hasWindow && hasFill
          ? `Окно модели занято на ${fillPct}% (${usedTokens.toLocaleString()} из ${windowTokens.toLocaleString()})`
          : null,
        'Нажми — полный расход и стоимость по API',
      ].filter(Boolean).join('\n')
    : 'Расход этой сессии пока неизвестен';

  return (
    <button
      type="button"
      onClick={onClick}
      className="composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label={
        hasSpend
          ? `В сессии ${formatTokenCount(spendTokens)} токенов${fillPct !== null ? `, окно ${fillPct}%` : ''}`
          : 'Показать расход токенов'
      }
    >
      <span className={`composer-chip-icon grid h-5 w-5 place-items-center rounded-md ${iconTone}`}>
        <ActivityIcon className="h-3.5 w-3.5" />
      </span>
      <span className="font-medium text-foreground">
        {hasSpend ? formatTokenCount(spendTokens) : '—'}
      </span>
      {fillPct !== null && (
        <span className={`font-medium tabular-nums ${fillTone}`}>{fillPct}%</span>
      )}
      {!hasSpend && !hasFill && (
        <span className="hidden text-muted-foreground/70 sm:inline">сессия</span>
      )}
    </button>
  );
}
