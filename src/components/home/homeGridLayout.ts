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

/**
 * Grid size while Home holds its tiles (the search field is focused with an
 * empty query, or the on-screen keyboard is up). On an iPhone the keyboard
 * shrinks the shell (`--keyboard-height`), and Home lost 2–3 of its 4 rows
 * the moment one tapped the empty search (review 23.11). Height never drops
 * below the one measured before the hold; width follows the measurement
 * (rotation still re-flows the columns).
 */
export function holdGridSize(measured: GridSize, held: GridSize | null): GridSize {
  if (!held) return measured;
  return { width: measured.width, height: Math.max(measured.height, held.height) };
}

export type GridHoldInput = {
  /** Apply the held size: the empty search is focused or the keyboard is up. */
  hold: boolean;
  /** The keyboard may be squeezing the area (field focused or keyboard up). */
  squeezed: boolean;
};

/**
 * One render of Home's grid: the size to lay out and the size to remember
 * for the next render (`rest`). `rest` is the last size measured while
 * nothing could squeeze the area, not the size at the moment the hold turned
 * on: typing a query drops the hold with the keyboard still up, and wiping it
 * (or the «clear» cross) must bring the rows measured with the keyboard closed back (review
 * of task 04), not freeze the squeezed ones.
 */
export function nextGridHold(
  rest: GridSize | null,
  measured: GridSize,
  { hold, squeezed }: GridHoldInput,
): { rest: GridSize | null; size: GridSize } {
  const nextRest = squeezed ? (rest ?? measured) : measured;
  return { rest: nextRest, size: hold ? holdGridSize(measured, nextRest) : measured };
}
