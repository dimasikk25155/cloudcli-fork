import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProjectCard, buildUsageCard, moscowDay, shortDayLabel } from './bioCardData';

const session = (output: number, costUsd: number | null) => ({
  day: '',
  project: 'p',
  projectPath: null,
  sessionId: 's',
  title: null,
  tokens: 0,
  output,
  model: null,
  lastActivity: '',
  costUsd,
});

describe('окно «Расход»: карточка «Токены · 7 дней»', () => {
  it('пока грузится, при ошибке и без работы — одна строка вместо данных', () => {
    assert.equal(buildUsageCard(null, null, '2026-11-09').state, 'loading');
    const failed = buildUsageCard(null, 'Usage history request failed (500)', '2026-11-09');
    assert.equal(failed.state, 'error');
    assert.equal(failed.message, 'Не удалось загрузить');
    // Работа была, но давно — в окне 7 дней пусто.
    const stale = buildUsageCard([{ day: '2026-10-01', tokens: 500, costUsd: 1, sessions: [] }], null, '2026-11-09');
    assert.equal(stale.state, 'empty');
    assert.equal(stale.message, 'Пока нет данных за 7 дней');
  });

  it('7 дней от старых к новым, итог, сегодняшний день выделен, линия — накопленные ≈$', () => {
    const card = buildUsageCard(
      [
        { day: '2026-11-09', tokens: 2_000_000, costUsd: 3, sessions: [session(40_000, 3)] },
        { day: '2026-11-05', tokens: 1_000_000, costUsd: 1.5, sessions: [session(10_000, 1), session(5_000, 0.5)] },
      ],
      null,
      '2026-11-09',
    );
    assert.equal(card.state, 'ready');
    assert.deepEqual(card.crumb, ['Neo3', 'Токены · 7 дней']);
    assert.deepEqual(card.table?.columns, ['День', 'Токены', 'Вывод', '≈$']);
    assert.equal(card.table?.rows.length, 7);
    assert.deepEqual(card.table?.rows[0], ['вт 03', '0', '0', '$0']);
    assert.deepEqual(card.table?.rows[2], ['чт 05', '1.0M', '15.0K', '$1.50']);
    assert.deepEqual(card.table?.rows[6], ['пн 09', '2.0M', '40.0K', '$3.00']);
    assert.deepEqual(card.table?.total, ['7 дней', '3.0M', '55.0K', '$4.50']);
    assert.deepEqual(card.table?.highlight, { row: 6, col: 1, badge: 'сегодня' });
    assert.deepEqual(card.formula, { cell: 'B9', expr: '=SUM(токены, 7 дн.)' });
    assert.deepEqual(card.stats, [
      { value: '3.0M', label: 'токенов за 7 дней' },
      { value: '≈$4.50', label: 'по ценам API' },
    ]);
    assert.deepEqual(card.chart?.bars, [0, 0, 1_000_000, 0, 0, 0, 2_000_000]);
    assert.deepEqual(card.chart?.line, [0, 0, 1.5, 1.5, 1.5, 1.5, 4.5]);
    assert.deepEqual(card.chart?.marker, { index: 6, label: 'сегодня' });
    assert.equal(card.chart?.labels[6], 'пн 09');
  });

  it('у моделей нет цен — линии нет, деньги «—»', () => {
    const card = buildUsageCard([{ day: '2026-11-09', tokens: 700, costUsd: null, sessions: [] }], null, '2026-11-09');
    assert.equal(card.state, 'ready');
    assert.equal(card.chart?.line, null);
    assert.equal(card.chart?.legend?.line, undefined);
    assert.deepEqual(card.stats?.[1], { value: '—', label: 'по ценам API' });
    assert.equal(card.table?.rows[6][3], '—');
  });
});

describe('статистика проекта: карточка «Проект · состав»', () => {
  const stats = {
    name: 'neo3',
    path: '/p',
    files: 120,
    lines: 10_000,
    bytes: 1,
    languages: [
      { ext: '.ts', files: 50, lines: 6_000 },
      { ext: '.css', files: 4, lines: 2_000 },
      { ext: '.md', files: 30, lines: 1_000 },
      { ext: '.js', files: 10, lines: 500 },
      { ext: '.json', files: 20, lines: 300 },
      { ext: '.sh', files: 5, lines: 150 },
      { ext: '.py', files: 1, lines: 50 },
    ],
    sessions: 3,
    tokens: 2_500_000,
    tokensIn: 2_000_000,
    tokensOut: 500_000,
    costUsd: 12.5,
    lastActivity: null,
    truncated: false,
  };

  it('до 5 языков + «прочее» + итог, доля крупнейшего выделена, маркер на 80% кода', () => {
    const card = buildProjectCard(stats);
    assert.equal(card.state, 'ready');
    assert.deepEqual(card.crumb, ['Neo3', 'Проект · состав']);
    assert.deepEqual(card.table?.columns, ['Язык', 'Файлы', 'Строки', 'Доля']);
    assert.deepEqual(
      card.table?.rows.map((row) => row[0]),
      ['.ts', '.css', '.md', '.js', '.json', 'прочее'],
    );
    assert.deepEqual(card.table?.rows[0], ['.ts', '50', '6 000', '60%']);
    assert.deepEqual(card.table?.rows[5], ['прочее', '6', '200', '2%']);
    assert.deepEqual(card.table?.total, ['Всего', '120', '10 000', '100%']);
    assert.deepEqual(card.table?.highlight, { row: 0, col: 3, badge: 'больше всех' });
    assert.deepEqual(card.formula, { cell: 'C8', expr: '=SUM(строки)' });
    assert.deepEqual(card.stats, [
      { value: '10 000', label: 'строк кода' },
      { value: '≈$12.50', label: 'по ценам API' },
    ]);
    assert.deepEqual(card.chart?.bars, [6_000, 2_000, 1_000, 500, 300, 200]);
    // .ts 60% → +.css 80%: вертикаль «80% кода» на втором столбике.
    assert.deepEqual(card.chart?.marker, { index: 1, label: '80% кода' });
    assert.equal(card.chart?.line?.length, 6);
    assert.ok(Math.abs((card.chart?.line?.[5] ?? 0) - 1) < 1e-9);
  });

  it('сервер прислал не все языки (≤ 8) — итог, «прочее», доли и 80% считаются от всех строк проекта', () => {
    // Языки в ответе дают 10 000 строк и 120 файлов, а в проекте 20 000 и 200.
    const card = buildProjectCard({ ...stats, files: 200, lines: 20_000 });
    assert.deepEqual(card.table?.rows[0], ['.ts', '50', '6 000', '30%']);
    // 20 000 − (6 000 + 2 000 + 1 000 + 500 + 300) = 10 200; 200 − 114 = 86.
    assert.deepEqual(card.table?.rows[5], ['прочее', '86', '10 200', '51%']);
    assert.deepEqual(card.table?.total, ['Всего', '200', '20 000', '100%']);
    assert.deepEqual(card.stats?.[0], { value: '20 000', label: 'строк кода' });
    assert.deepEqual(card.chart?.bars, [6_000, 2_000, 1_000, 500, 300, 10_200]);
    // 30% → 40% → 45% → 47,5% → 49% → 100%: 80% достигается только на «прочем».
    assert.deepEqual(card.chart?.marker, { index: 5, label: '80% кода' });
    assert.ok(Math.abs((card.chart?.line?.[5] ?? 0) - 1) < 1e-9);

    // Языков ≤ 5, но строк в проекте больше — «прочее» всё равно появляется.
    const few = buildProjectCard({ ...stats, files: 10, lines: 1_000, languages: [{ ext: '.ts', files: 4, lines: 600 }] });
    assert.deepEqual(few.table?.rows, [
      ['.ts', '4', '600', '60%'],
      ['прочее', '6', '400', '40%'],
    ]);
    assert.deepEqual(few.table?.total, ['Всего', '10', '1 000', '100%']);
  });

  it('сумма языков больше итога проекта — берётся сумма, «прочее» не уходит в минус', () => {
    const card = buildProjectCard({ ...stats, files: 50, lines: 5_000 });
    assert.deepEqual(card.table?.rows[5], ['прочее', '6', '200', '2%']);
    assert.deepEqual(card.table?.total, ['Всего', '120', '10 000', '100%']);
  });

  it('скан упёрся в лимит — «не меньше»; нет цены — токены', () => {
    const card = buildProjectCard({ ...stats, truncated: true, costUsd: null });
    assert.match(card.stats?.[0].label ?? '', /не меньше/);
    assert.deepEqual(card.stats?.[1], { value: '2.5M', label: 'токенов' });
  });

  it('языков нет — одна строка', () => {
    const card = buildProjectCard({ ...stats, languages: [] });
    assert.equal(card.state, 'empty');
    assert.equal(card.message, 'Пока нет данных о составе');
  });
});

describe('дни', () => {
  it('короткая подпись дня и московский день', () => {
    assert.equal(shortDayLabel('2026-11-09'), 'пн 09');
    assert.equal(shortDayLabel('2026-11-01'), 'вс 01');
    // 21:30 UTC 8 ноября — в Москве уже 9-е.
    assert.equal(moscowDay(new Date('2026-11-08T21:30:00Z')), '2026-11-09');
  });
});
