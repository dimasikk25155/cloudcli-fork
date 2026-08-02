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

/** Window size without a trailing ".0" — 1000000 → "1M", 200000 → "200K". */
const formatWindow = (value: number) => {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  return `${Math.round(value / 1_000)}K`;
};

const readUsageNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Context fill level, not a spend meter: `used` is the last turn's context
 * footprint and `total` is the model's real window (1M on current Opus/Sonnet).
 * Showing the raw number alone was unreadable — "310K" means nothing until you
 * know whether the window is 200K or 1M.
 */
export default function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const windowTokens = readUsageNumber(usage?.total);

  const hasWindow = windowTokens > 0;
  const fillPct = hasWindow ? Math.min(999, Math.round((usedTokens / windowTokens) * 100)) : null;

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

  const title = hasWindow
    ? `Контекст: ${usedTokens.toLocaleString()} из ${windowTokens.toLocaleString()} токенов (${fillPct}%)`
      + `\nВход (с кэшем): ${inputTokens.toLocaleString()} · Выход: ${outputTokens.toLocaleString()}`
      + '\nНажми — полный расход и стоимость по API'
    : `${usedTokens.toLocaleString()} tokens used`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label={
        hasWindow
          ? `Контекст заполнен на ${fillPct} процентов`
          : 'Show token usage'
      }
    >
      <span className={`composer-chip-icon grid h-5 w-5 place-items-center rounded-md ${iconTone}`}>
        <ActivityIcon className="h-3.5 w-3.5" />
      </span>
      <span className="font-medium text-foreground">{usage == null ? '—' : formatTokenCount(usedTokens)}</span>
      {usage != null && hasWindow && (
        <>
          <span className="hidden text-muted-foreground/60 sm:inline">/ {formatWindow(windowTokens)}</span>
          <span className={`font-medium tabular-nums ${fillTone}`}>{fillPct}%</span>
        </>
      )}
      {(usage == null || !hasWindow) && (
        <span className="hidden text-muted-foreground/70 sm:inline">tokens</span>
      )}
    </button>
  );
}
