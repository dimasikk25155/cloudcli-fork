import { ActivityIcon } from 'lucide-react';
import React from 'react';

import { CHIP_METER, CHIP_METER_ICON } from './composerChips';

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
  const tone = percentage !== null && percentage >= 85 ? 'text-destructive'
    : percentage !== null && percentage >= 60 ? 'text-warning' : 'text-foreground';

  return (
    <button
      type="button"
      onClick={onClick}
      className={CHIP_METER}
      title={title}
      aria-label={`Контекст ${label}. Показать расход токенов`}
    >
      {React.createElement(ActivityIcon, { className: CHIP_METER_ICON, 'aria-hidden': true })}
      <span className={`font-medium tabular-nums ${tone}`}>{label}</span>
    </button>
  );
}
