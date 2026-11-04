/**
 * Привязка перемещаемого элемента: к краям и центрам соседей (с направляющими),
 * иначе к сетке. Координаты — CSS-пиксели документа iframe (без масштаба).
 */

export interface Rect { x: number; y: number; w: number; h: number }

type Guide = { axis: 'x' | 'y'; pos: number };

/** Start, centre and end of a box on one axis. */
const lines = (start: number, size: number) => [start, start + size / 2, start + size];

const COINCIDE = 0.5;

function snapAxis(start: number, size: number, others: number[][], grid: number, threshold: number): { start: number; guides: number[] } {
  let best: { delta: number } | null = null;
  for (const own of lines(start, size)) {
    for (const set of others) {
      for (const line of set) {
        const delta = line - own;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta };
      }
    }
  }
  if (best) {
    const snapped = start + best.delta;
    const own = lines(snapped, size);
    const guides: number[] = [];
    for (const set of others) {
      for (const line of set) {
        if (own.some((value) => Math.abs(value - line) <= COINCIDE) && !guides.includes(line)) guides.push(line);
      }
    }
    return { start: snapped, guides };
  }
  return { start: grid > 0 ? Math.round(start / grid) * grid : start, guides: [] };
}

/**
 * Where the moved box lands: on each axis the closest pair of lines (edge or
 * centre of the box vs edge or centre of a neighbour) within `threshold`;
 * none — the top-left corner goes to the `grid`. Size is kept.
 */
export function snapRect(moving: Rect, others: Rect[], opts: { grid: number; threshold: number; enabled: boolean }): { rect: Rect; guides: Guide[] } {
  if (!opts.enabled) return { rect: moving, guides: [] };
  const x = snapAxis(moving.x, moving.w, others.map((other) => lines(other.x, other.w)), opts.grid, opts.threshold);
  const y = snapAxis(moving.y, moving.h, others.map((other) => lines(other.y, other.h)), opts.grid, opts.threshold);
  return {
    rect: { x: x.start, y: y.start, w: moving.w, h: moving.h },
    guides: [...x.guides.map((pos): Guide => ({ axis: 'x', pos })), ...y.guides.map((pos): Guide => ({ axis: 'y', pos }))],
  };
}
