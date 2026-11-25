import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { cn } from '../../../../lib/utils';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  readSidebarWidth,
  sidebarMaxWidthFor,
  sidebarWidthForKey,
  writeSidebarWidth,
} from '../../utils/sidebarWidth';

const viewportWidth = (): number | undefined =>
  typeof window === 'undefined' ? undefined : window.innerWidth;

/**
 * Сохранённая ширина панели с поправкой на текущее окно: окно сузили —
 * панель ужимается, чтобы чату осталось место; расширили — возвращается.
 */
export function useSidebarWidth() {
  const [storedWidth, setStoredWidth] = useState(readSidebarWidth);
  const [viewport, setViewport] = useState(viewportWidth);

  useEffect(() => {
    const onResize = () => setViewport(viewportWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const commitWidth = useCallback((next: number) => {
    const width = clampSidebarWidth(next);
    setStoredWidth(width);
    writeSidebarWidth(width);
  }, []);

  return { width: clampSidebarWidth(storedWidth, viewport), commitWidth };
}

type SidebarResizeHandleProps = {
  /** Корень панели: во время перетаскивания ширина ставится ему напрямую, без перерисовки списка. */
  targetRef: RefObject<HTMLElement | null>;
  width: number;
  onCommit: (width: number) => void;
};

/**
 * Полоска у правого края панели: тянуть — шире/уже, двойной щелчок — обычная
 * ширина, стрелки на клавиатуре — по шагу.
 */
export default function SidebarResizeHandle({ targetRef, width, onCommit }: SidebarResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const finish = useCallback((pointerId?: number, target?: Element) => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    if (target && pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    if (state) onCommit(state.width);
  }, [onCommit]);

  // Перетаскивание оборвалось вместе с компонентом — вернуть курсор и выделение.
  useEffect(() => () => {
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startWidth = targetRef.current?.getBoundingClientRect().width ?? width;
    drag.current = { startX: event.clientX, startWidth, width: startWidth };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен — перетаскивание дойдёт по обычным событиям.
    }
    event.preventDefault();
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const next = clampSidebarWidth(state.startWidth + event.clientX - state.startX, viewportWidth());
    if (next === state.width) return;
    state.width = next;
    if (targetRef.current) targetRef.current.style.width = `${next}px`;
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    finish(event.pointerId, event.currentTarget);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = sidebarWidthForKey(event.key, width, event.shiftKey, viewportWidth());
    if (next === null) return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина панели"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={sidebarMaxWidthFor(viewportWidth())}
      aria-valuenow={width}
      title="Потяните, чтобы изменить ширину. Двойной щелчок — обычная ширина"
      tabIndex={0}
      data-sidebar-resize-handle=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={() => { if (drag.current) finish(); }}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -right-2.5 z-30 w-3 cursor-col-resize touch-none select-none outline-none"
    >
      <span
        aria-hidden
        className={cn(
          // 2px внутри панели, остальное снаружи — не мешает полосе прокрутки списка.
          'absolute inset-y-0 left-0.5 w-px transition-colors duration-150',
          dragging
            ? 'w-0.5 bg-primary'
            : 'bg-transparent group-hover:w-0.5 group-hover:bg-primary/60 group-focus-visible:w-0.5 group-focus-visible:bg-primary',
        )}
      />
    </div>
  );
}
