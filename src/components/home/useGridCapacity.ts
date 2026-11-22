import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import { homeGridLayout, nextGridHold, type GridSize, type HomeGridLayout } from './homeGridLayout';

// Measure before paint in the browser; on the server there is nothing to measure.
const useBrowserLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Columns, whole rows and cells of the Home grid for the element's content box
 * (padding excluded). Re-measured by ResizeObserver: rotation, window resize,
 * the search field appearing, the keyboard. `initialSize` is used until the
 * first measurement (server render, previews).
 *
 * `hold` — keep the rows measured while not `squeezed` (`nextGridHold`):
 * Home holds while the empty search is focused / the keyboard is up, so the
 * keyboard squeezing the shell does not take tiles away. `squeezed` — the
 * field is focused or the keyboard is up (defaults to `hold`); measurements
 * taken then are not remembered, so a hold that turns on again mid-keyboard
 * (query wiped, «clear» cross) still gets the keyboard-free rows.
 */
export function useGridCapacity(
  ref: RefObject<HTMLElement | null>,
  initialSize: GridSize = { width: 0, height: 0 },
  hold = false,
  squeezed = hold,
): HomeGridLayout {
  const [size, setSize] = useState<GridSize>(initialSize);
  const [rest, setRest] = useState<GridSize | null>(initialSize);
  // Derived state, adjusted during render (focus comes before the keyboard,
  // so the last unsqueezed measurement is the one from before it).
  const grid = nextGridHold(rest, size, { hold, squeezed });
  if (grid.rest !== rest) setRest(grid.rest);

  useBrowserLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const apply = (width: number, height: number) => {
      const next = { width: Math.floor(width), height: Math.floor(height) };
      setSize((previous) => (
        previous.width === next.width && previous.height === next.height ? previous : next
      ));
    };

    const style = window.getComputedStyle(element);
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    apply(element.clientWidth - (paddingX || 0), element.clientHeight - (paddingY || 0));

    const observer = new ResizeObserver(([entry]) => {
      if (entry) apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return homeGridLayout(grid.size);
}
