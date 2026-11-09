import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildChartGeometry,
  cumulative,
  firstIndexAtShare,
  lastNDays,
  topLanguages,
} from './bioChartModel';

const box = { width: 100, height: 60, padding: { top: 10, right: 0, bottom: 10, left: 0 } };

describe('buildChartGeometry', () => {
  it('без данных график не рисуется', () => {
    const geometry = buildChartGeometry({ ...box, labels: [], bars: [] });
    assert.equal(geometry.isEmpty, true);
    assert.deepEqual(geometry.bars, []);
    assert.equal(geometry.linePath, null);
    assert.equal(geometry.marker, null);
  });

  it('все нули и нет линии — пусто, но без NaN', () => {
    const geometry = buildChartGeometry({ ...box, labels: ['a', 'b', 'c'], bars: [0, 0, 0] });
    assert.equal(geometry.isEmpty, true);
    for (const bar of geometry.bars) {
      assert.equal(bar.height, 0);
      assert.ok(Number.isFinite(bar.y));
    }
  });

  it('все нули, но линия задана нулями — тоже пусто', () => {
    const geometry = buildChartGeometry({ ...box, labels: ['a', 'b'], bars: [0, 0], line: [0, 0] });
    assert.equal(geometry.isEmpty, true);
  });

  it('один день: столбик по центру во всю высоту, линия из одной точки', () => {
    const geometry = buildChartGeometry({ ...box, labels: ['пн 03'], bars: [5], line: [2] });
    assert.equal(geometry.isEmpty, false);
    assert.equal(geometry.baselineY, 50);
    assert.equal(geometry.bars.length, 1);
    const [bar] = geometry.bars;
    assert.equal(bar.x + bar.width / 2, 50, 'центр столбика — середина ширины');
    assert.equal(bar.y, 10, 'максимум столбиков достаёт до верхнего отступа');
    assert.equal(bar.height, 40);
    assert.deepEqual(geometry.linePoints, [{ x: 50, y: 10 }]);
    assert.equal(geometry.linePath, 'M 50 10');
    assert.deepEqual(geometry.xLabels, [{ x: 50, text: 'пн 03' }]);
  });

  it('столбики и линия — каждая в своей шкале от одной базовой линии', () => {
    // Столбики в тысячах, линия в единицах: каждая доходит до верха своим максимумом.
    const geometry = buildChartGeometry({
      ...box,
      labels: ['a', 'b'],
      bars: [1000, 4000],
      line: [1, 2],
    });
    assert.deepEqual(
      geometry.bars.map((bar) => bar.height),
      [10, 40],
    );
    assert.deepEqual(
      geometry.bars.map((bar) => bar.y + bar.height),
      [50, 50],
      'столбики стоят на базовой линии',
    );
    assert.deepEqual(geometry.linePoints, [
      { x: 25, y: 30 },
      { x: 75, y: 10 },
    ]);
    assert.equal(geometry.linePath, 'M 25 30 L 75 10');
  });

  it('маркер без линии стоит на верхушке столбика', () => {
    const geometry = buildChartGeometry({
      ...box,
      labels: ['a', 'b'],
      bars: [2, 4],
      markerIndex: 0,
    });
    assert.equal(geometry.linePath, null);
    assert.deepEqual(geometry.linePoints, []);
    assert.deepEqual(geometry.marker, { x: 25, y: 30, index: 0 });
  });

  it('маркер с линией стоит на точке линии; маркер вне диапазона не рисуется', () => {
    const withLine = buildChartGeometry({ ...box, labels: ['a', 'b'], bars: [2, 4], line: [3, 3], markerIndex: 1 });
    assert.deepEqual(withLine.marker, { x: 75, y: 10, index: 1 });
    const outside = buildChartGeometry({ ...box, labels: ['a', 'b'], bars: [2, 4], markerIndex: 5 });
    assert.equal(outside.marker, null);
  });
});

describe('cumulative и firstIndexAtShare', () => {
  it('накопленная сумма', () => {
    assert.deepEqual(cumulative([1, 2, 3, 0]), [1, 3, 6, 6]);
    assert.deepEqual(cumulative([]), []);
  });

  it('первый индекс, где накопленная доля достигает 80%', () => {
    // 50 + 30 = 80 из 100 → ровно 80% на индексе 1.
    assert.equal(firstIndexAtShare([50, 30, 15, 5], 0.8), 1);
    // 40 + 30 = 70 < 80, 40 + 30 + 20 = 90 ≥ 80 → индекс 2.
    assert.equal(firstIndexAtShare([40, 30, 20, 10], 0.8), 2);
    assert.equal(firstIndexAtShare([0, 0], 0.8), null);
    assert.equal(firstIndexAtShare([], 0.8), null);
  });
});

describe('lastNDays', () => {
  it('ровно n дней от старых к новым, пропуски заполнены нулями', () => {
    // Сервер отдаёт дни новыми вперёд и только дни с работой.
    const days = [
      { day: '2026-11-09', tokens: 900, output: 90, costUsd: 1.5 },
      { day: '2026-11-07', tokens: 700, costUsd: null },
      { day: '2026-11-01', tokens: 100, output: 10, costUsd: 0.1 }, // вне окна 7 дней
    ];
    const result = lastNDays(days, 7, '2026-11-09');
    assert.equal(result.length, 7);
    assert.deepEqual(
      result.map((entry) => entry.day),
      ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'],
    );
    assert.deepEqual(result[6], { day: '2026-11-09', tokens: 900, output: 90, costUsd: 1.5 });
    assert.deepEqual(result[4], { day: '2026-11-07', tokens: 700, output: 0, costUsd: null });
    assert.deepEqual(result[0], { day: '2026-11-03', tokens: 0, output: 0, costUsd: 0 });
  });

  it('окно переходит через границу месяца', () => {
    const result = lastNDays([], 3, '2026-12-01');
    assert.deepEqual(
      result.map((entry) => entry.day),
      ['2026-11-29', '2026-11-30', '2026-12-01'],
    );
  });
});

describe('topLanguages', () => {
  const languages = [
    { ext: '.css', files: 3, lines: 100 },
    { ext: '.ts', files: 40, lines: 500 },
    { ext: '.md', files: 9, lines: 50 },
    { ext: '.js', files: 10, lines: 200 },
    { ext: '.json', files: 5, lines: 50 },
    { ext: '.sh', files: 2, lines: 60 },
    { ext: '.py', files: 1, lines: 40 },
  ];

  it('по строкам убыв., хвост сворачивается в «прочее», доли в сумме 1', () => {
    const result = topLanguages(languages, 3);
    assert.deepEqual(
      result.map((entry) => entry.ext),
      ['.ts', '.js', '.css', 'прочее'],
    );
    // .sh 60 + .md 50 + .json 50 + .py 40 = 200 строк в 2 + 9 + 5 + 1 = 17 файлах.
    assert.deepEqual(result[3], { ext: 'прочее', files: 17, lines: 200, share: 0.2 });
    assert.equal(result[0].share, 0.5);
    const total = result.reduce((sum, entry) => sum + entry.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `сумма долей ${total}`);
  });

  it('языков не больше лимита — «прочего» нет', () => {
    const result = topLanguages(languages.slice(0, 2), 5);
    assert.deepEqual(
      result.map((entry) => entry.ext),
      ['.ts', '.css'],
    );
  });
});
