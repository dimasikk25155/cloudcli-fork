import React from 'react';

import { buildChartGeometry } from './bioChartModel';

/**
 * Карточка-инфографика по образцу «Finance model» с hu22.ai: крупные тонкие
 * цифры, ряд голубых чёрточек, тонкий заголовок, а в рамке — крошка и «● live»,
 * строка формулы, таблица-спредшит и под ней график (серые столбики, одна
 * голубая линия, пунктирная вертикаль с кружком). Одна карточка = одна мысль.
 *
 * Чистый компонент: без контекстов, хуков данных и i18n — все подписи приходят
 * через props. Цвета только из токенов темы (классы Tailwind и `.bio-card-*`
 * в index.css), поэтому в любой теме карточка своя.
 */

export type BioDataCardProps = {
  /** Тонкий заголовок над карточкой («Finance model» на скриншоте). */
  title?: string;
  /** ['Neo3', 'Токены · 7 дней'] */
  crumb: [string, string];
  /** Строка формулы: 'F9', '=SUM(токены, 7 дн.)'. */
  formula?: { cell: string; expr: string };
  /** «● live» */
  live?: boolean;
  /** ≤ 2 */
  stats?: { value: string; label: string }[];
  table?: {
    /** Первая — текст, остальные — числа (моно, вправо). */
    columns: string[];
    rows: string[][];
    /** Итоговая строка жирным. */
    total?: string[];
    /** Голубая рамка + ✓ + бейдж-«курсор» с текстом badge. */
    highlight?: { row: number | 'total'; col: number; badge?: string };
  };
  chart?: {
    labels: string[];
    bars: number[];
    line?: number[] | null;
    marker?: { index: number; label: string } | null;
    legend?: { bars: string; line?: string };
  };
  state?: 'ready' | 'loading' | 'empty' | 'error';
  /** Текст для loading/empty/error. */
  message?: string;
  className?: string;
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 168;
const CHART_PADDING = { top: 24, right: 24, bottom: 10, left: 24 };
const DASHES = 6;

/** A, B, …, Z, AA… — буквы колонок, как в таблице. */
function columnLetter(index: number): string {
  let label = '';
  let rest = index;
  do {
    label = String.fromCharCode(65 + (rest % 26)) + label;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return label;
}

const percent = (value: number) => `${(value / CHART_WIDTH) * 100}%`;

const BADGE_CLASS =
  'whitespace-nowrap rounded-[7px] bg-primary px-1.5 font-mono text-[10px] font-normal leading-[15px] text-primary-foreground';

/** Курсор с бейджем, висящий под ячейкой, — как «Check» на скриншоте. */
function Cursor({ text }: { text: string }) {
  return (
    <span className="pointer-events-none absolute right-1 top-[calc(100%-6px)] z-10 flex items-start" aria-hidden="true">
      <svg width="11" height="13" viewBox="0 0 11 13" className="-mr-1 shrink-0 fill-primary">
        <path d="M1 1 L1 11 L3.8 8.4 L5.6 12.2 L7.2 11.5 L5.5 7.8 L9.4 7.6 Z" />
      </svg>
      <span className={`mt-2.5 ${BADGE_CLASS}`}>{text}</span>
    </span>
  );
}

function Sheet({ table }: { table: NonNullable<BioDataCardProps['table']> }) {
  const { columns, rows, total, highlight } = table;
  const lastRowIndex = total ? rows.length + 1 : rows.length;
  const highlightRowIndex = highlight ? (highlight.row === 'total' ? rows.length + 1 : highlight.row + 1) : -1;
  // Курсор висит под ячейкой только на последней строке (воздух — отступом внутри
  // прокрутки). Под любой другой он закрыл бы число строки ниже — там бейдж
  // стоит в самой ячейке, перед значением.
  const badgeBelowLast = Boolean(highlight?.badge) && highlightRowIndex === lastRowIndex;
  const cell = 'border-b border-r border-border px-2 last:border-r-0';

  const renderRow = (values: string[], rowIndex: number, kind: 'head' | 'body' | 'total') => {
    const isLast = rowIndex === lastRowIndex;
    return (
      <tr key={rowIndex} className={kind === 'total' ? 'font-semibold text-foreground' : undefined}>
        <td
          className={`${cell} w-6 bg-muted/40 px-0 text-center font-mono text-[10px] font-normal text-muted-foreground ${isLast ? 'rounded-bl-md border-b-0' : ''}`}
        >
          {rowIndex + 1}
        </td>
        {columns.map((_, colIndex) => {
          const value = values[colIndex] ?? '';
          const numeric = colIndex > 0;
          const selected = rowIndex === highlightRowIndex && colIndex === highlight?.col;
          const tone =
            kind === 'head'
              ? 'text-muted-foreground'
              : selected
                ? 'text-primary'
                : kind === 'total'
                  ? 'text-foreground'
                  : numeric
                    ? 'text-foreground/85'
                    : 'text-muted-foreground';
          return (
            <td
              key={colIndex}
              data-selected={selected ? 'true' : undefined}
              className={`${cell} relative h-[26px] whitespace-nowrap ${numeric ? 'text-right font-mono tabular-nums' : 'text-left'} ${tone} ${isLast ? 'border-b-0' : ''} ${isLast && colIndex === columns.length - 1 ? 'rounded-br-md' : ''}`}
              style={selected ? { boxShadow: 'inset 0 0 0 1px hsl(var(--primary))' } : undefined}
            >
              {selected ? (
                <span className="flex items-center justify-between gap-2">
                  <span aria-hidden="true">✓</span>
                  <span className="flex items-center gap-1.5">
                    {highlight?.badge && !badgeBelowLast ? <span className={BADGE_CLASS}>{highlight.badge}</span> : null}
                    <span>{value}</span>
                  </span>
                </span>
              ) : (
                value
              )}
              {selected && highlight?.badge && badgeBelowLast ? <Cursor text={highlight.badge} /> : null}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className={`mt-2 overflow-x-auto ${badgeBelowLast ? 'pb-6' : ''}`}>
      <table className="w-full min-w-[22rem] border-separate border-spacing-0 rounded-md border border-border text-[11.5px]">
        <thead>
          <tr>
            <th className={`${cell} h-[22px] w-6 rounded-tl-md bg-muted/40`} aria-hidden="true" />
            {columns.map((_, colIndex) => (
              <th
                key={colIndex}
                scope="col"
                className={`${cell} h-[22px] bg-muted/40 text-center font-mono text-[10px] font-normal text-muted-foreground ${colIndex === columns.length - 1 ? 'rounded-tr-md' : ''}`}
              >
                {columnLetter(colIndex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderRow(columns, 0, 'head')}
          {rows.map((row, index) => renderRow(row, index + 1, 'body'))}
          {total ? renderRow(total, rows.length + 1, 'total') : null}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ chart }: { chart: NonNullable<BioDataCardProps['chart']> }) {
  const geometry = buildChartGeometry({
    labels: chart.labels,
    bars: chart.bars,
    line: chart.line,
    markerIndex: chart.marker?.index ?? null,
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    padding: CHART_PADDING,
  });
  if (geometry.isEmpty) {
    return null;
  }
  const hasLine = Boolean(geometry.linePath);
  const marker = geometry.marker;
  const markerOnRight = marker ? marker.x > CHART_WIDTH * 0.75 : false;

  return (
    <div className="mt-4">
      {chart.legend ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[2px] bg-muted-foreground/40" aria-hidden="true" />
            {chart.legend.bars}
          </span>
          {hasLine && chart.legend.line ? (
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block h-[2px] w-3 rounded-[1px] bg-primary" aria-hidden="true" />
              {chart.legend.line}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="relative mt-2">
        {marker && chart.marker?.label ? (
          <span
            className="absolute top-0 whitespace-nowrap font-mono text-[10px] leading-none text-primary"
            style={
              markerOnRight
                ? { right: `calc(${100 - (marker.x / CHART_WIDTH) * 100}% + 6px)` }
                : { left: `calc(${percent(marker.x)} + 6px)` }
            }
          >
            {chart.marker.label}
          </span>
        ) : null}
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          className="block h-auto w-full overflow-visible"
          aria-hidden="true"
          focusable="false"
        >
          <line className="bio-card-grid" x1={0} x2={CHART_WIDTH} y1={CHART_PADDING.top} y2={CHART_PADDING.top} />
          <line
            className="bio-card-grid"
            x1={0}
            x2={CHART_WIDTH}
            y1={(CHART_PADDING.top + geometry.baselineY) / 2}
            y2={(CHART_PADDING.top + geometry.baselineY) / 2}
          />
          {geometry.bars.map((bar) => (
            <rect
              key={bar.index}
              className="bio-card-bar"
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={2}
            />
          ))}
          <line className="bio-card-baseline" x1={0} x2={CHART_WIDTH} y1={geometry.baselineY} y2={geometry.baselineY} />
          {geometry.linePath ? <path className="bio-card-line" d={geometry.linePath} pathLength={1} /> : null}
          {marker ? (
            <>
              <line className="bio-card-marker" x1={marker.x} x2={marker.x} y1={4} y2={marker.y} />
              <circle className="bio-card-dot" cx={marker.x} cy={marker.y} r={4.5} />
            </>
          ) : null}
        </svg>
        <div className="relative mt-2 h-4 font-mono text-[10px] text-muted-foreground">
          {geometry.xLabels.map((label, index) => (
            <span
              key={index}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{ left: percent(label.x) }}
            >
              {label.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BioDataCard({
  title,
  crumb,
  formula,
  live = false,
  stats,
  table,
  chart,
  state = 'ready',
  message,
  className,
}: BioDataCardProps) {
  const ready = state === 'ready';
  const shownStats = ready ? (stats ?? []).slice(0, 2) : [];

  return (
    <figure className={`bio-card m-0 min-w-0 ${className ?? ''}`} data-state={state}>
      {shownStats.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-5">
            {shownStats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <div className="truncate font-sans text-[2rem] font-extralight tabular-nums leading-none tracking-[-0.045em] text-primary">
                  {stat.value}
                </div>
                <div className="mt-2 text-xs leading-snug text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-1.5" aria-hidden="true">
            {Array.from({ length: DASHES }, (_, index) => (
              <span key={index} className="h-[2px] w-6 rounded-full bg-primary/80" />
            ))}
          </div>
        </>
      ) : null}

      {title ? (
        <figcaption
          className={`${shownStats.length > 0 ? 'mt-5' : ''} mb-3 font-sans text-[1.375rem] font-light leading-tight tracking-[-0.02em] text-foreground`}
        >
          {title}
        </figcaption>
      ) : null}

      <div className="rounded-[calc(var(--radius)+2px)] border border-border bg-card p-3 sm:p-4">
        {ready ? (
          <>
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
              <div className="min-w-0 truncate">
                {crumb[0]}
                <span className="px-1.5 opacity-50">/</span>
                <span className="text-foreground">{crumb[1]}</span>
              </div>
              {live ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                  live
                </div>
              ) : null}
            </div>

            {formula ? (
              <div className="mt-3 flex h-7 items-center gap-3 overflow-hidden whitespace-nowrap rounded-md border border-border px-2.5 font-mono text-[11px] text-muted-foreground">
                <span className="min-w-6 text-foreground">{formula.cell}</span>
                <span className="italic opacity-70">fx</span>
                <span className="truncate">{formula.expr}</span>
              </div>
            ) : null}

            {table ? <Sheet table={table} /> : null}
            {chart ? <Chart chart={chart} /> : null}
          </>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">{message ?? ''}</p>
        )}
      </div>
    </figure>
  );
}
