import { ActivityIcon } from 'lucide-react';
import React from 'react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  contextWindow?: number;
  onClick?: () => void;
};

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const format = (value: number) => value.toLocaleString('ru-RU');

/** Latest occupied context / selected model maximum. Spend is detail only. */
export default function TokenUsageSummary({ usage, contextWindow, onClick }: TokenUsageSummaryProps) {
  const used = count(usage?.used);
  const maximum = count(contextWindow);
  const runtime = count(usage?.total);
  const percentage = used !== null && maximum !== null && maximum > 0
    ? Math.round(used / maximum * 100) : null;
  const label = percentage === null ? '—' : `${percentage}%`;
  const input = count(usage?.inputTokens) ?? 0;
  const output = count(usage?.outputTokens) ?? 0;
  const title = [
    percentage !== null ? `Контекст: ${label} (${format(used!)} из ${format(maximum!)} токенов)`
      : `Контекст: ${used === null ? 'занятость неизвестна' : `${format(used)} токенов`}${!maximum ? '; максимум модели неизвестен' : ''}`,
    runtime && runtime !== maximum ? `Текущий лимит сессии: ${format(runtime)} токенов` : null,
    input + output > 0 ? `Расход: ${format(input + output)} токенов (вход ${format(input)} · выход ${format(output)})` : null,
    'Нажми — полный расход и стоимость по API',
  ].filter(Boolean).join('\n');
  const tone = percentage !== null && percentage >= 85 ? 'text-red-500'
    : percentage !== null && percentage >= 60 ? 'text-amber-500' : 'text-muted-foreground';

  return (
    <button
      type="button"
      onClick={onClick}
      className="composer-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={title}
      aria-label={`Контекст ${label}. Показать расход токенов`}
    >
      <span className="composer-chip-icon grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        {React.createElement(ActivityIcon, { className: 'h-3.5 w-3.5' })}
      </span>
      <span className={`font-medium tabular-nums ${tone}`}>{label}</span>
    </button>
  );
}
