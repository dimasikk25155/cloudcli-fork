import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { clampRatio } from './workbenchStore';

type WorkbenchLayoutProps = {
  /** Show the canvas next to the chat. Off — the children render exactly as before. */
  enabled: boolean;
  /** Canvas share of the width (0.25..0.75). */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  canvas: ReactNode;
  /** The chat column; always rendered first so the chat never remounts on toggle. */
  children: ReactNode;
};

const KEYBOARD_STEP = 0.05;

/**
 * Split «чат | холст» inside the main content row. The border between them is
 * dragged with the mouse (as the editor side panel); the width is saved once,
 * when the drag ends. Desktop only — the phone shows the canvas full-screen.
 */
export default function WorkbenchLayout({ enabled, ratio, onRatioChange, canvas, children }: WorkbenchLayoutProps) {
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      dragRef.current = null;
      setDragRatio(null);
    }
  }, [enabled]);

  const ratioAt = useCallback((clientX: number): number | null => {
    const container = handleRef.current?.parentElement;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clampRatio((rect.right - clientX) / rect.width);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = ratio;
    setDragRatio(ratio);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    const next = ratioAt(event.clientX);
    if (next === null) return;
    dragRef.current = next;
    setDragRatio(next);
  };

  const endDrag = () => {
    const final = dragRef.current;
    dragRef.current = null;
    setDragRatio(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (final !== null && final !== ratio) onRatioChange(final);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The separator sits left of the canvas: ← widens the canvas, → narrows it.
    if (event.key === 'ArrowLeft') onRatioChange(clampRatio(ratio + KEYBOARD_STEP));
    else if (event.key === 'ArrowRight') onRatioChange(clampRatio(ratio - KEYBOARD_STEP));
    else return;
    event.preventDefault();
  };

  const shown = dragRatio ?? ratio;

  return (
    <>
      {children}
      {enabled && (
        <>
          <div
            ref={handleRef}
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница чата и холста"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(shown * 100)}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="group relative w-1.5 flex-shrink-0 cursor-col-resize bg-transparent focus-visible:outline-none"
            data-workbench-resize
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary" />
          </div>
          <section
            aria-label="Холст рабочего стола"
            className="flex min-h-0 min-w-[320px] flex-shrink-0 flex-col overflow-hidden"
            style={{ width: `${shown * 100}%` }}
            data-workbench-panel
          >
            {canvas}
          </section>
        </>
      )}
    </>
  );
}
