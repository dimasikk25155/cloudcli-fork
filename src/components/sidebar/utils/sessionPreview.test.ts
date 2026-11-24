import assert from 'node:assert/strict';
import test from 'node:test';

import { previewSessionRows, SESSION_PREVIEW_SIZE } from './sessionPreview.js';

const top = (id: string) => ({ session: { id }, depth: 0 });
const child = (id: string) => ({ session: { id }, depth: 1 });
const ids = (rows: Array<{ session: { id: string } }>) => rows.map((row) => row.session.id);

const twelve = Array.from({ length: 12 }, (_, index) => top(`s${index + 1}`));

test('сразу видно первые 5, остальные считаются скрытыми', () => {
  const result = previewSessionRows(twelve, SESSION_PREVIEW_SIZE, new Set());
  assert.deepEqual(ids(result.rows), ['s1', 's2', 's3', 's4', 's5']);
  assert.equal(result.hiddenCount, 7);
});

test('«Показать ещё» поднимает предел — видно больше, скрытых меньше', () => {
  const result = previewSessionRows(twelve, 15, new Set());
  assert.equal(result.rows.length, 12);
  assert.equal(result.hiddenCount, 0);
});

test('работающий, открытый и закреплённый чат виден даже за пределом и на своём месте', () => {
  const result = previewSessionRows(twelve, 2, new Set(['s9', 's4']));
  assert.deepEqual(ids(result.rows), ['s1', 's2', 's4', 's9']);
  assert.equal(result.hiddenCount, 8);
});

test('вложенные чаты идут вместе с родителем и не занимают места в пятёрке', () => {
  const rows = [top('a'), child('a1'), child('a2'), top('b'), child('b1'), top('c')];
  const result = previewSessionRows(rows, 2, new Set());
  assert.deepEqual(ids(result.rows), ['a', 'a1', 'a2', 'b', 'b1']);
  assert.equal(result.hiddenCount, 1);
});

test('вложенный работающий чат скрытого родителя всё равно виден', () => {
  const rows = [top('a'), top('b'), child('b1')];
  const result = previewSessionRows(rows, 1, new Set(['b1']));
  assert.deepEqual(ids(result.rows), ['a', 'b1']);
});
