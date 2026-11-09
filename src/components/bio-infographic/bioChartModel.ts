/**
 * Арифметика карточки-инфографики без React: шкалы, накопление, точка 80%,
 * заполнение пустых дней. Компонент `BioDataCard` только рисует то, что здесь
 * посчитано, поэтому всё проверяемое живёт в этом файле.
 */

export type BioChartInput = {
  /** Подписи оси X, слева направо. */
  labels: string[];
  /** Высоты столбиков, ≥ 0, той же длины, что подписи. */
  bars: number[];
  /** Линия той же длины; null/нет → линии нет. */
  line?: number[] | null;
  markerIndex?: number | null;
  /** В единицах viewBox. */
  width: number;
  height: number;
  padding?: { top: number; right: number; bottom: number; left: number };
};

export type BioChartGeometry = {
  bars: { x: number; y: number; width: number; height: number; index: number }[];
  /** 'M x y L x y …' */
  linePath: string | null;
  linePoints: { x: number; y: number }[];
  /** y — точка линии (или верх столбика, если линии нет). */
  marker: { x: number; y: number; index: number } | null;
  baselineY: number;
  xLabels: { x: number; text: string }[];
  /** Все столбики нулевые и линии нет (или она нулевая) → график не рисуется. */
  isEmpty: boolean;
};

const DEFAULT_PADDING = { top: 28, right: 16, bottom: 8, left: 16 };
/** Доля слота под столбик: остальное — воздух между столбиками. */
const BAR_FILL = 0.46;

const finite = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const nonNegative = (value: number | null | undefined): number => Math.max(0, finite(value));

/** Округление до сотых: путь читается и не тащит хвосты 0.30000000000000004. */
const round = (value: number): number => Math.round(value * 100) / 100;

export function buildChartGeometry(input: BioChartInput): BioChartGeometry {
  const padding = input.padding ?? DEFAULT_PADDING;
  const count = input.bars.length;
  const innerWidth = Math.max(0, input.width - padding.left - padding.right);
  const innerHeight = Math.max(0, input.height - padding.top - padding.bottom);
  const baselineY = round(input.height - padding.bottom);
  const slot = count > 0 ? innerWidth / count : 0;
  const centerX = (index: number) => round(padding.left + slot * (index + 0.5));

  const barValues = input.bars.map(nonNegative);
  const lineValues =
    Array.isArray(input.line) && input.line.length === count ? input.line.map(nonNegative) : null;

  // Каждая серия в своей шкале: максимум серии достаёт до верхнего отступа.
  const barMax = Math.max(0, ...barValues);
  const lineMax = lineValues ? Math.max(0, ...lineValues) : 0;
  const scaled = (value: number, max: number) => (max > 0 ? (value / max) * innerHeight : 0);

  const barWidth = round(slot * BAR_FILL);
  const bars = barValues.map((value, index) => {
    const height = round(scaled(value, barMax));
    return {
      x: round(centerX(index) - barWidth / 2),
      y: round(baselineY - height),
      width: barWidth,
      height,
      index,
    };
  });

  const linePoints = lineValues
    ? lineValues.map((value, index) => ({ x: centerX(index), y: round(baselineY - scaled(value, lineMax)) }))
    : [];
  const linePath =
    linePoints.length > 0
      ? linePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
      : null;

  const markerIndex = input.markerIndex;
  const marker =
    typeof markerIndex === 'number' && Number.isInteger(markerIndex) && markerIndex >= 0 && markerIndex < count
      ? {
          x: centerX(markerIndex),
          y: linePoints.length > 0 ? linePoints[markerIndex].y : bars[markerIndex].y,
          index: markerIndex,
        }
      : null;

  const xLabels = barValues.map((_, index) => ({ x: centerX(index), text: input.labels[index] ?? '' }));

  return {
    bars,
    linePath,
    linePoints,
    marker,
    baselineY,
    xLabels,
    isEmpty: count === 0 || (barMax === 0 && lineMax === 0),
  };
}

export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((value) => {
    sum += finite(value);
    return sum;
  });
}

/** Первый индекс, где накопленная доля ≥ share (0..1); нет суммы → null. */
export function firstIndexAtShare(values: number[], share: number): number | null {
  const running = cumulative(values.map(nonNegative));
  const total = running.length > 0 ? running[running.length - 1] : 0;
  if (total <= 0) return null;
  const index = running.findIndex((sum) => sum / total >= share - 1e-9);
  return index >= 0 ? index : null;
}

type DayInput = { day: string; tokens: number; output?: number; costUsd: number | null };
type DayOutput = { day: string; tokens: number; output: number; costUsd: number | null };

/** YYYY-MM-DD ± дни по календарю, без часовых поясов. */
function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, (month || 1) - 1, date || 1) + delta * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Ровно `n` дней, заканчивая `today`, от старых к новым. День без работы —
 * нули (работы не было, значит и стоимость $0); дни вне окна отбрасываются.
 */
export function lastNDays(days: DayInput[], n: number, today: string): DayOutput[] {
  const byDay = new Map<string, DayInput>();
  for (const entry of days) {
    if (!byDay.has(entry.day)) byDay.set(entry.day, entry);
  }
  const result: DayOutput[] = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    const entry = byDay.get(day);
    result.push(
      entry
        ? {
            day,
            tokens: nonNegative(entry.tokens),
            output: nonNegative(entry.output),
            costUsd: typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : null,
          }
        : { day, tokens: 0, output: 0, costUsd: 0 },
    );
  }
  return result;
}

export const OTHER_LANGUAGES = 'прочее';

/** До `limit` языков по строкам (убыв.), хвост — одной строкой «прочее». */
export function topLanguages(
  languages: { ext: string; files: number; lines: number }[],
  limit: number,
): { ext: string; files: number; lines: number; share: number }[] {
  const sorted = [...languages].sort(
    (a, b) => nonNegative(b.lines) - nonNegative(a.lines) || nonNegative(b.files) - nonNegative(a.files) || a.ext.localeCompare(b.ext),
  );
  const head = sorted.slice(0, Math.max(0, limit));
  const tail = sorted.slice(head.length);
  const rows = head.map((entry) => ({ ext: entry.ext, files: nonNegative(entry.files), lines: nonNegative(entry.lines) }));
  if (tail.length > 0) {
    rows.push({
      ext: OTHER_LANGUAGES,
      files: tail.reduce((sum, entry) => sum + nonNegative(entry.files), 0),
      lines: tail.reduce((sum, entry) => sum + nonNegative(entry.lines), 0),
    });
  }
  const total = rows.reduce((sum, entry) => sum + entry.lines, 0);
  return rows.map((entry) => ({ ...entry, share: total > 0 ? entry.lines / total : 0 }));
}
