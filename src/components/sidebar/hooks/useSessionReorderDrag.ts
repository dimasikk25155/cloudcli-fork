import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Touch has to distinguish "scrolling the sidebar" from "grabbing a card", so a
// drag starts only after a press-and-hold. A mouse has no such ambiguity: press
// and move a few pixels is enough.
const TOUCH_LONG_PRESS_MS = 350;
const MOUSE_DRAG_THRESHOLD_PX = 5;
const TOUCH_SCROLL_CANCEL_PX = 12;
const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_STEP_PX = 14;

export type SessionDragState = {
  /** Session being carried. */
  sessionId: string;
  /** Its index in the list the drag started from. */
  fromIndex: number;
  /** Slot the card would land in: 0..length, counted before removal. */
  insertionIndex: number;
  /** Vertical shift applied to the carried card, in pixels. */
  offsetY: number;
};

type PointerSession = {
  pointerId: number;
  sessionId: string;
  index: number;
  startY: number;
  element: HTMLElement;
  isDragging: boolean;
};

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

const findScrollParent = (element: HTMLElement | null): HTMLElement | null => {
  let current: HTMLElement | null = element?.parentElement ?? null;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

type UseSessionReorderDragArgs = {
  /** Session ids in their current on-screen order. */
  sessionIds: string[];
  /** Called with the full reordered list once a card is dropped. */
  onReorder: (orderedSessionIds: string[]) => void;
  disabled?: boolean;
};

/**
 * Press-and-hold reordering for the sidebar session list, driven by Pointer
 * Events so mouse and finger share one code path (no drag-and-drop library
 * needed for a single vertical list).
 *
 * While a card is carried the other rows stay put — a drop line marks the
 * landing slot. Measuring the rows once at drag start keeps the target
 * calculation stable even though the carried card moves under the cursor.
 */
export function useSessionReorderDrag({ sessionIds, onReorder, disabled = false }: UseSessionReorderDragArgs) {
  const [drag, setDrag] = useState<SessionDragState | null>(null);
  const pointerRef = useRef<PointerSession | null>(null);
  const rowCentersRef = useRef<number[]>([]);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suppressClickRef = useRef(false);
  const sessionIdsRef = useRef(sessionIds);
  const dragRef = useRef<SessionDragState | null>(null);

  sessionIdsRef.current = sessionIds;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  const updateDrag = useCallback((updater: (previous: SessionDragState) => SessionDragState) => {
    setDrag((previous) => {
      if (!previous) {
        return previous;
      }
      const next = updater(previous);
      dragRef.current = next;
      return next;
    });
  }, []);

  const computeInsertionIndex = useCallback((clientY: number): number => {
    const centers = rowCentersRef.current;
    let insertionIndex = 0;
    for (const center of centers) {
      if (clientY > center) {
        insertionIndex += 1;
      }
    }
    return insertionIndex;
  }, []);

  const beginDrag = useCallback((clientY: number) => {
    const pointerSession = pointerRef.current;
    if (!pointerSession || pointerSession.isDragging) {
      return;
    }

    const container = pointerSession.element.closest<HTMLElement>('[data-session-list]');
    const rows = container ? Array.from(container.querySelectorAll<HTMLElement>('[data-session-row]')) : [];
    rowCentersRef.current = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });

    pointerSession.isDragging = true;
    try {
      pointerSession.element.setPointerCapture(pointerSession.pointerId);
    } catch {
      // Capture is an optimisation; the window-level listeners below still work.
    }

    // Short buzz so a long-press on a phone confirms the card was picked up.
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(15);
    }

    const nextDrag: SessionDragState = {
      sessionId: pointerSession.sessionId,
      fromIndex: pointerSession.index,
      insertionIndex: pointerSession.index,
      offsetY: clientY - pointerSession.startY,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }, []);

  const finishDrag = useCallback(
    (commit: boolean) => {
      const pointerSession = pointerRef.current;
      const currentDrag = dragRef.current;

      clearLongPressTimer();
      stopAutoScroll();

      if (pointerSession) {
        try {
          pointerSession.element.releasePointerCapture(pointerSession.pointerId);
        } catch {
          // Already released (pointercancel), nothing to do.
        }
      }

      pointerRef.current = null;
      dragRef.current = null;
      setDrag(null);

      if (!currentDrag) {
        return;
      }

      // A finished drag must not also open the session it was carrying.
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (!commit) {
        return;
      }

      const { fromIndex, insertionIndex } = currentDrag;
      const toIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
      if (toIndex === fromIndex) {
        return;
      }

      onReorder(moveItem(sessionIdsRef.current, fromIndex, toIndex));
    },
    [clearLongPressTimer, onReorder, stopAutoScroll],
  );

  const startAutoScroll = useCallback((clientY: number) => {
    const pointerSession = pointerRef.current;
    if (!pointerSession) {
      return;
    }

    const scrollParent = findScrollParent(pointerSession.element);
    if (!scrollParent) {
      return;
    }

    const bounds = scrollParent.getBoundingClientRect();
    const direction = clientY < bounds.top + AUTO_SCROLL_EDGE_PX
      ? -1
      : clientY > bounds.bottom - AUTO_SCROLL_EDGE_PX
        ? 1
        : 0;

    if (direction === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollRef.current) {
      return;
    }

    autoScrollRef.current = setInterval(() => {
      const before = scrollParent.scrollTop;
      scrollParent.scrollTop = before + direction * AUTO_SCROLL_STEP_PX;
      const delta = scrollParent.scrollTop - before;
      if (delta === 0) {
        return;
      }
      // Rows measured at drag start move with the scroll container.
      rowCentersRef.current = rowCentersRef.current.map((center) => center - delta);
      updateDrag((previous) => ({ ...previous, offsetY: previous.offsetY + delta }));
    }, 16);
  }, [stopAutoScroll, updateDrag]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const pointerSession = pointerRef.current;
      if (!pointerSession || event.pointerId !== pointerSession.pointerId) {
        return;
      }

      const distance = Math.abs(event.clientY - pointerSession.startY);

      if (!pointerSession.isDragging) {
        if (event.pointerType === 'mouse' && distance > MOUSE_DRAG_THRESHOLD_PX) {
          beginDrag(event.clientY);
        } else if (event.pointerType !== 'mouse' && distance > TOUCH_SCROLL_CANCEL_PX) {
          // The finger is scrolling, not holding — let the sidebar scroll.
          clearLongPressTimer();
          pointerRef.current = null;
        }
        return;
      }

      event.preventDefault();
      updateDrag((previous) => ({
        ...previous,
        offsetY: event.clientY - pointerSession.startY,
        insertionIndex: computeInsertionIndex(event.clientY),
      }));
      startAutoScroll(event.clientY);
    };

    const handleUp = (event: PointerEvent) => {
      const pointerSession = pointerRef.current;
      if (!pointerSession || event.pointerId !== pointerSession.pointerId) {
        return;
      }

      if (!pointerSession.isDragging) {
        clearLongPressTimer();
        pointerRef.current = null;
        return;
      }

      finishDrag(event.type === 'pointerup');
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [beginDrag, clearLongPressTimer, computeInsertionIndex, finishDrag, startAutoScroll, updateDrag]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      stopAutoScroll();
    };
  }, [clearLongPressTimer, stopAutoScroll]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, index: number, sessionId: string) => {
      if (disabled || sessionIdsRef.current.length < 2) {
        return;
      }

      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      // Row controls (rename, delete, the rename input) keep their own gestures.
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input, textarea')) {
        return;
      }

      pointerRef.current = {
        pointerId: event.pointerId,
        sessionId,
        index,
        startY: event.clientY,
        element: event.currentTarget,
        isDragging: false,
      };

      if (event.pointerType !== 'mouse') {
        const { clientY } = event;
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => beginDrag(clientY), TOUCH_LONG_PRESS_MS);
      }
    },
    [beginDrag, clearLongPressTimer, disabled],
  );

  // Rows call this from onClickCapture so the drop that just happened does not
  // register as "open this session".
  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  return {
    drag,
    handlePointerDown,
    shouldSuppressClick,
  };
}
