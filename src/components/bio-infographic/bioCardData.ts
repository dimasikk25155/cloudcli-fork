import type { ProjectStats } from '../../utils/projectStats';
import { formatCount } from '../../utils/projectStats';
import { formatTokensShort, formatUsd, type UsageHistoryDay } from '../../utils/usageHistory';

import type { BioDataCardProps } from './BioDataCard';
import { OTHER_LANGUAGES, cumulative, firstIndexAtShare, lastNDays, topLanguages } from './bioChartModel';

/**
 * Данные → props карточки для двух мест: окно «Расход» (R06) и статистика
 * проекта (R07). Чистые функции: компонент рисует, модель считает, здесь —
 * только подписи и раскладка по строкам таблицы.
 */

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WINDOW_DAYS = 7;
const TOP_LANGUAGES = 5;

/** Московский календарный день YYYY-MM-DD — как считает сервер истории. */
export function moscowDay(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

/** 'пн 09' — день недели и число, коротко для оси и таблицы. */
export function shortDayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, (month || 1) - 1, date || 1)).getUTCDay()] ?? '';
  return `${weekday} ${String(date || 0).padStart(2, '0')}`.trim();
}

const approxUsd = (value: number | null): string => (value === null ? formatUsd(null) : `≈${formatUsd(value)}`);

const USAGE_CRUMB: [string, string] = ['Neo3', 'Токены · 7 дней'];
const USAGE_TITLE = 'Расход за неделю';

/** R06: токены по дням за 7 дней, сегодняшний день выделен, линия — накопленные ≈$. */
export function buildUsageCard(
  days: UsageHistoryDay[] | null,
  error: string | null,
  today: string,
): BioDataCardProps {
  const base = { title: USAGE_TITLE, crumb: USAGE_CRUMB, live: true };
  if (error) {
    return { ...base, state: 'error', message: 'Не удалось загрузить' };
  }
  if (!days) {
    return { ...base, state: 'loading', message: 'Загружаю расход…' };
  }

  const week = lastNDays(
    days.map((entry) => ({
      day: entry.day,
      tokens: entry.tokens,
      output: (entry.sessions ?? []).reduce((sum, session) => sum + (Number(session.output) || 0), 0),
      costUsd: entry.costUsd,
    })),
    WINDOW_DAYS,
    today,
  );
  const totalTokens = week.reduce((sum, entry) => sum + entry.tokens, 0);
  if (totalTokens <= 0) {
    return { ...base, state: 'empty', message: 'Пока нет данных за 7 дней' };
  }

  const totalOutput = week.reduce((sum, entry) => sum + entry.output, 0);
  // Цены есть, если хоть один день с работой посчитан по тарифу.
  const priced = week.some((entry) => entry.tokens > 0 && entry.costUsd !== null);
  const costs = week.map((entry) => entry.costUsd ?? 0);
  const totalCost = priced ? costs.reduce((sum, value) => sum + value, 0) : null;
  const labels = week.map((entry) => shortDayLabel(entry.day));
  const todayIndex = week.length - 1;

  return {
    ...base,
    state: 'ready',
    formula: { cell: `B${week.length + 2}`, expr: '=SUM(токены, 7 дн.)' },
    stats: [
      { value: formatTokensShort(totalTokens), label: 'токенов за 7 дней' },
      { value: approxUsd(totalCost), label: 'по ценам API' },
    ],
    table: {
      columns: ['День', 'Токены', 'Вывод', '≈$'],
      rows: week.map((entry, index) => [
        labels[index],
        formatTokensShort(entry.tokens),
        formatTokensShort(entry.output),
        priced ? formatUsd(entry.costUsd) : formatUsd(null),
      ]),
      total: ['7 дней', formatTokensShort(totalTokens), formatTokensShort(totalOutput), formatUsd(totalCost)],
      highlight: { row: todayIndex, col: 1, badge: 'сегодня' },
    },
    chart: {
      labels,
      bars: week.map((entry) => entry.tokens),
      line: priced ? cumulative(costs) : null,
      marker: { index: todayIndex, label: 'сегодня' },
      legend: priced ? { bars: 'токены', line: 'накоплено ≈$' } : { bars: 'токены' },
    },
  };
}

const PROJECT_CRUMB: [string, string] = ['Neo3', 'Проект · состав'];

const formatShare = (share: number): string => {
  if (share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
};

/** R07: до 5 языков + «прочее», доля крупнейшего выделена, вертикаль «80% кода». */
export function buildProjectCard(stats: ProjectStats, title = 'Из чего состоит'): BioDataCardProps {
  const base = { title, crumb: PROJECT_CRUMB, live: true };
  const ranked = topLanguages(stats.languages ?? [], TOP_LANGUAGES);
  const shown = ranked.filter((entry) => entry.ext !== OTHER_LANGUAGES);
  const sumOf = (rows: { lines: number; files: number }[], key: 'lines' | 'files') =>
    rows.reduce((sum, entry) => sum + entry[key], 0);

  // Сервер присылает не больше 8 языков, поэтому итог берётся из stats.lines/files;
  // сумма языков — нижняя граница, чтобы «прочее» не ушло в минус.
  const totalLines = Math.max(sumOf(ranked, 'lines'), Number.isFinite(stats.lines) ? stats.lines : 0);
  const totalFiles = Math.max(sumOf(ranked, 'files'), Number.isFinite(stats.files) ? stats.files : 0);
  if (ranked.length === 0 || totalLines <= 0) {
    return { ...base, state: 'empty', message: 'Пока нет данных о составе' };
  }

  const otherLines = totalLines - sumOf(shown, 'lines');
  const otherFiles = totalFiles - sumOf(shown, 'files');
  const rows = shown.map(({ ext, files, lines }) => ({ ext, files, lines }));
  if (otherLines > 0 || otherFiles > 0 || shown.length < ranked.length) {
    rows.push({ ext: OTHER_LANGUAGES, files: otherFiles, lines: otherLines });
  }
  const languages = rows.map((entry) => ({ ...entry, share: entry.lines / totalLines }));
  const lines = languages.map((entry) => entry.lines);
  const markerIndex = firstIndexAtShare(lines, 0.8);

  return {
    ...base,
    state: 'ready',
    formula: { cell: `C${languages.length + 2}`, expr: '=SUM(строки)' },
    stats: [
      {
        value: formatCount(stats.lines),
        // Скан упёрся в лимит файлов: числа — нижняя граница.
        label: stats.truncated ? 'строк кода · не меньше' : 'строк кода',
      },
      stats.costUsd !== null && stats.costUsd !== undefined
        ? { value: approxUsd(stats.costUsd), label: 'по ценам API' }
        : { value: formatTokensShort(stats.tokens ?? 0), label: 'токенов' },
    ],
    table: {
      columns: ['Язык', 'Файлы', 'Строки', 'Доля'],
      rows: languages.map((entry) => [
        entry.ext,
        formatCount(entry.files),
        formatCount(entry.lines),
        formatShare(entry.share),
      ]),
      total: ['Всего', formatCount(totalFiles), formatCount(totalLines), '100%'],
      highlight: { row: 0, col: 3, badge: 'больше всех' },
    },
    chart: {
      labels: languages.map((entry) => entry.ext),
      bars: lines,
      line: cumulative(languages.map((entry) => entry.share)),
      marker: markerIndex === null ? null : { index: markerIndex, label: '80% кода' },
      legend: { bars: 'строки', line: 'накопленная доля' },
    },
  };
}
