import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import { homeGridLayout, type GridSize, type HomeGridLayout } from './homeGridLayout';

// Measure before paint in the browser; on the server there is nothing to measure.
const useBrowserLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Columns, whole rows and cells of the Home grid for the element's content box
 * (padding excluded). Re-measured by ResizeObserver: rotation, window resize,
 * the search field appearing, the keyboard. `initialSize` is used until the
 * first measurement (server render, previews).
 */
export function useGridCapacity(
  ref: RefObject<HTMLElement | null>,
  initialSize: GridSize = { width: 0, height: 0 },
): HomeGridLayout {
  const [size, setSize] = useState<GridSize>(initialSize);

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

  return homeGridLayout(size);
}
