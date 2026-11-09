import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import BioDataCard, { type BioDataCardProps } from './BioDataCard';

const render = (props: BioDataCardProps) => renderToStaticMarkup(React.createElement(BioDataCard, props));

const full: BioDataCardProps = {
  title: 'Расход за неделю',
  crumb: ['Neo3', 'Токены · 7 дней'],
  formula: { cell: 'B5', expr: '=SUM(токены, 7 дн.)' },
  live: true,
  stats: [
    { value: '3.0M', label: 'токенов за 7 дней' },
    { value: '≈$4.50', label: 'по ценам API' },
  ],
  table: {
    columns: ['День', 'Токены', '≈$'],
    rows: [
      ['сб 07', '1.0M', '$1.50'],
      ['вс 08', '0', '$0'],
    ],
    total: ['7 дней', '3.0M', '$4.50'],
    highlight: { row: 1, col: 1, badge: 'сегодня' },
  },
  chart: {
    labels: ['сб 07', 'вс 08'],
    bars: [1_000_000, 0],
    line: [1.5, 1.5],
    marker: { index: 1, label: 'сегодня' },
    legend: { bars: 'токены', line: 'накоплено ≈$' },
  },
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('BioDataCard', () => {
  it('рисует заголовок, крошку, «● live», цифры и строку формулы', () => {
    const html = render(full);
    const plain = text(html);
    assert.match(plain, /Расход за неделю/);
    assert.match(plain, /Neo3 \/ Токены · 7 дней/);
    assert.match(plain, /live/);
    assert.match(plain, /3\.0M токенов за 7 дней/);
    assert.match(plain, /B5 fx =SUM\(токены, 7 дн\.\)/);
  });

  it('таблица как спредшит: буквы колонок, номера строк, итог жирным', () => {
    const html = render(full);
    const heads = [...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map((entry) => entry[1]);
    assert.deepEqual(heads, ['A', 'B', 'C']);
    // Строка 1 — названия колонок, 2–3 — данные, 4 — итог.
    const rowNumbers = [...html.matchAll(/<tr[^>]*><td[^>]*>(\d+)<\/td>/g)].map((entry) => entry[1]);
    assert.deepEqual(rowNumbers, ['1', '2', '3', '4']);
    assert.match(html, /<tr class="[^"]*font-semibold[^"]*"><td[^>]*>4<\/td>/);
    assert.match(html, /overflow-x-auto/, 'на узком экране таблица прокручивается вбок');
  });

  it('выделенная ячейка — голубая рамка, ✓ и бейдж-курсор', () => {
    const html = render(full);
    const selected = html.match(/<td data-selected="true"[^>]*>([\s\S]*?)<\/td>/);
    assert.ok(selected, 'нет выделенной ячейки');
    assert.match(selected[0], /box-shadow:inset 0 0 0 1px hsl\(var\(--primary\)\)/);
    assert.match(selected[1], /✓/);
    assert.match(selected[1], /0/);
    assert.match(text(selected[1]), /сегодня/);
  });

  it('график: легенда из двух пунктов, столбики, линия, пунктирный маркер с кружком', () => {
    const html = render(full);
    assert.match(text(html), /токены накоплено ≈\$/);
    assert.equal([...html.matchAll(/<rect class="bio-card-bar"/g)].length, 2);
    assert.match(html, /<path class="bio-card-line" d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+"/);
    assert.match(html, /<line class="bio-card-marker"/);
    assert.match(html, /<circle class="bio-card-dot"/);
    assert.match(html, /<svg viewBox="0 0 \d+ \d+" width="100%"/);
    assert.doesNotMatch(html, /preserveAspectRatio="none"/);
  });

  it('без линии — нет пути и второго пункта легенды; пустой график не рисуется', () => {
    const noLine = render({ ...full, chart: { ...full.chart!, line: null } });
    assert.doesNotMatch(noLine, /bio-card-line/);
    assert.doesNotMatch(noLine, /накоплено/);
    const empty = render({ ...full, chart: { labels: ['a'], bars: [0] } });
    assert.doesNotMatch(empty, /<svg viewBox/);
  });

  it('загрузка, пусто и ошибка — только одна строка message', () => {
    for (const state of ['loading', 'empty', 'error'] as const) {
      const html = render({ ...full, state, message: 'Пока нет данных за 7 дней' });
      assert.match(text(html), /Пока нет данных за 7 дней/);
      assert.doesNotMatch(html, /<table|<svg viewBox|fx|live|3\.0M/, state);
    }
  });

  it('цвета только из токенов темы: ни одного hex в компоненте', () => {
    const source = readFileSync(new URL('./BioDataCard.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(source, /rgba?\(/);
  });
});

describe('BioDataCard: бейдж не закрывает соседние числа', () => {
  it('на последней строке курсор висит под ячейкой, на любой другой — бейдж в самой ячейке', () => {
    const onTotal = render({ ...full, table: { ...full.table!, highlight: { row: 'total', col: 1, badge: 'итог' } } });
    assert.match(onTotal, /top-\[calc\(100%-6px\)\][^>]*>[\s\S]*?итог/, 'на итоге — курсор под ячейкой');
    assert.match(onTotal, /overflow-x-auto pb-6/, 'под курсором есть воздух внутри прокрутки');
    // Сегодня — не последняя строка (ниже итог): висящий бейдж закрыл бы итог.
    const onRow = render(full);
    assert.doesNotMatch(onRow, /top-\[calc\(100%-6px\)\]/);
    assert.doesNotMatch(onRow, /overflow-x-auto pb-6/);
    const selected = onRow.match(/<td data-selected="true"[^>]*>([\s\S]*?)<\/td>/);
    assert.match(text(selected?.[1] ?? ''), /✓ сегодня 0/);
  });
});
