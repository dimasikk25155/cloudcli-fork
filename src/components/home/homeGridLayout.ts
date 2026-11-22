/**
 * Сколько плиток «Домой» помещается в область сетки без прокрутки:
 * колонки — по ширине (4/6/8/10), строки — сколько целых влезает по высоте,
 * минимум одна. Без React — чистая функция под тест; размер области
 * меряет `useGridCapacity` (ResizeObserver).
 */

export type GridSize = { width: number; height: number };

export type HomeGridLayout = {
  columns: number;
  rows: number;
  /** columns × rows; the last cell is the «All projects» tile. */
  capacity: number;
  columnGap: number;
  rowGap: number;
  cellHeight: number;
};

/** Tile 68 px + 8 px gap + two label lines of 12 px × 1.25. */
export const HOME_CELL_HEIGHT = 106;

/** Narrowest cell that still gives the 68 px tile and its label room. */
const MIN_CELL_WIDTH = 88;
const COLUMN_STEPS = [10, 8, 6, 4] as const;
/** Grid narrower than this is a phone: tighter gaps, like `gap-x-4 gap-y-6`. */
const PHONE_MAX_WIDTH = 560;

export function homeGridLayout({ width, height }: GridSize): HomeGridLayout {
  const phone = width < PHONE_MAX_WIDTH;
  const columnGap = phone ? 16 : 20;
  const rowGap = phone ? 24 : 28;

  const columns = COLUMN_STEPS.find(
    (count) => (width - (count - 1) * columnGap) / count >= MIN_CELL_WIDTH,
  ) ?? 4;
  const rows = Math.max(1, Math.floor((height + rowGap) / (HOME_CELL_HEIGHT + rowGap)));

  return { columns, rows, capacity: columns * rows, columnGap, rowGap, cellHeight: HOME_CELL_HEIGHT };
}
