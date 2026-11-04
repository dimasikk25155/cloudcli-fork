/**
 * Слой поверх iframe правки: подсветка наведения, рамки выделения, ручки
 * размера, направляющие привязки. Перетаскивание и ручки обрабатываются
 * здесь, наружу уходят готовые действия в пикселях документа.
 *
 * Координаты от моста — CSS-пиксели документа iframe; на экран их переводит
 * `docRectToScreen` (минус прокрутка iframe, умножить на масштаб).
 * Слой пропускает мышь в iframe везде, кроме рамок и ручек.
 */

import React, { useEffect, useRef, useState } from 'react';

import type { ParentLayout } from './editorProtocol';
import {
  DRAG_START_PX,
  SNAP_GRID,
  SNAP_THRESHOLD_PX,
  docRectToScreen,
  reorderTarget,
  resizeFromHandle,
  screenDeltaToDoc,
  screenPointToDoc,
  unionRect,
  type ResizeHandle,
  type SiblingBox,
  type ViewTransform,
} from './editorUiModel';
import { snapRect, type Rect } from './snap';

export interface SelectedBox {
  id: string;
  rect: Rect;
  parentLayout: ParentLayout;
  editableText: boolean;
  resizable: boolean;
}

type Guide = { axis: 'x' | 'y'; pos: number };

type Drag =
  | { mode: 'move'; startX: number; startY: number; moved: boolean; boxes: SelectedBox[]; boxId: string; shift: boolean }
  | { mode: 'resize'; startX: number; startY: number; moved: boolean; box: SelectedBox; handle: ResizeHandle };

type Preview = { ghost: Rect | null; guides: Guide[]; line: Rect | null };

const NO_PREVIEW: Preview = { ghost: null, guides: [], line: null };

const HANDLES: { handle: ResizeHandle; className: string; cursor: string; label: string }[] = [
  { handle: 'e', className: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize', label: 'Ширина' },
  { handle: 's', className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize', label: 'Высота' },
  { handle: 'se', className: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize', label: 'Ширина и высота' },
];

const boxStyle = (rect: Rect): React.CSSProperties => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });

export default function SelectionOverlay(props: {
  view: ViewTransform;
  hover: { id: string | null; rect: Rect } | null;
  selected: SelectedBox[];
  /** Neighbours of the single selected element (snap and reorder). */
  siblings: SiblingBox[];
  snap: boolean;
  /** Text is being edited in the iframe: frames are drawn, but let the mouse through. */
  editing: boolean;
  /** «Выбрать внутри»: the next click goes to the iframe even over a frame. */
  passthrough: boolean;
  onMove: (input: { ids: string[]; dx: number; dy: number }) => void;
  onReorder: (input: { id: string; beforeId: string | null }) => void;
  onResize: (input: { id: string; width: number; height: number }) => void;
  onToggle: (id: string) => void;
  onDoubleClick: (box: SelectedBox) => void;
}) {
  const { view, hover, selected, editing, passthrough } = props;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Preview>(NO_PREVIEW);
  const latest = useRef({ props, preview, drag });
  latest.current = { props, preview, drag };

  useEffect(() => {
    if (!drag) return undefined;
    const stagePoint = (event: PointerEvent) => {
      const box = layerRef.current?.getBoundingClientRect();
      return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
    };
    const compute = (event: PointerEvent, current: Drag): Preview => {
      const { view: v, siblings: sibs, snap: snapOn } = latest.current.props;
      const delta = screenDeltaToDoc(event.clientX - current.startX, event.clientY - current.startY, v.zoom);
      const snapping = snapOn && !event.altKey;
      if (current.mode === 'resize') {
        const size = resizeFromHandle(current.box.rect, current.handle, delta.dx, delta.dy, { grid: SNAP_GRID, snap: snapping });
        return { ghost: { x: current.box.rect.x, y: current.box.rect.y, w: size.w, h: size.h }, guides: [], line: null };
      }
      const single = current.boxes.length === 1 ? current.boxes[0] : null;
      if (single && single.parentLayout !== 'block') {
        const point = screenPointToDoc(stagePoint(event), v);
        return { ghost: null, guides: [], line: reorderTarget(point, sibs, single.parentLayout).line };
      }
      const start = unionRect(current.boxes.map((b) => b.rect));
      if (!start) return NO_PREVIEW;
      const moving = { ...start, x: start.x + delta.dx, y: start.y + delta.dy };
      const others = single ? sibs.map((s) => s.rect) : [];
      const snapped = snapRect(moving, others, { grid: SNAP_GRID, threshold: SNAP_THRESHOLD_PX / v.zoom, enabled: snapping });
      return { ghost: snapped.rect, guides: snapped.guides, line: null };
    };
    const onMovePointer = (event: PointerEvent) => {
      const current = latest.current.drag;
      if (!current) return;
      if (!current.moved) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_START_PX) return;
        current.moved = true;
      }
      event.preventDefault();
      setPreview(compute(event, current));
    };
    const onUp = (event: PointerEvent) => {
      const current = latest.current.drag;
      setDrag(null);
      setPreview(NO_PREVIEW);
      if (!current) return;
      const handlers = latest.current.props;
      if (!current.moved) {
        if (current.mode === 'move' && current.shift) handlers.onToggle(current.boxId);
        return;
      }
      const result = compute(event, current);
      if (current.mode === 'resize') {
        if (result.ghost) handlers.onResize({ id: current.box.id, width: result.ghost.w, height: result.ghost.h });
        return;
      }
      const single = current.boxes.length === 1 ? current.boxes[0] : null;
      if (single && single.parentLayout !== 'block') {
        const point = screenPointToDoc(stagePoint(event), handlers.view);
        handlers.onReorder({ id: single.id, beforeId: reorderTarget(point, handlers.siblings, single.parentLayout).beforeId });
        return;
      }
      const start = unionRect(current.boxes.map((b) => b.rect));
      if (!start || !result.ghost) return;
      const dx = result.ghost.x - start.x;
      const dy = result.ghost.y - start.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
      handlers.onMove({ ids: current.boxes.map((b) => b.id), dx, dy });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrag(null);
      setPreview(NO_PREVIEW);
    };
    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // A new drag starts a new listening session; the rest is read from `latest`.
  }, [drag]);

  const startMove = (event: React.PointerEvent, box: SelectedBox) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ mode: 'move', startX: event.clientX, startY: event.clientY, moved: false, boxes: selected, boxId: box.id, shift: event.shiftKey });
  };
  const startResize = (event: React.PointerEvent, box: SelectedBox, handle: ResizeHandle) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ mode: 'resize', startX: event.clientX, startY: event.clientY, moved: false, box, handle });
  };

  const interactive = !editing && !passthrough;
  const showHover = hover && !drag && !selected.some((box) => box.id === hover.id);
  const hoverRect = hover ? docRectToScreen(hover.rect, view) : null;

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-editor-overlay>
      {showHover && hoverRect && (
        <div
          className={`absolute rounded-[2px] border ${hover.id ? 'border-primary/70' : 'border-dashed border-amber-500'}`}
          style={boxStyle(hoverRect)}
          aria-hidden
        />
      )}

      {selected.map((box) => {
        const rect = docRectToScreen(box.rect, view);
        const single = selected.length === 1;
        return (
          <div
            key={box.id}
            data-editor-box={box.id}
            className={`absolute border-2 border-primary ${interactive ? 'pointer-events-auto cursor-move' : ''} ${editing ? 'border-dashed' : ''}`}
            style={boxStyle(rect)}
            onPointerDown={interactive ? (event) => startMove(event, box) : undefined}
            onDoubleClick={interactive ? () => props.onDoubleClick(box) : undefined}
            title={box.parentLayout === 'block' ? 'Тяни — сдвинуть. Двойной клик — править текст или выбрать внутри' : 'Тяни — поменять порядок. Двойной клик — править текст или выбрать внутри'}
          >
            {single && interactive && box.resizable && HANDLES.map(({ handle, className, cursor, label }) => (
              <span
                key={handle}
                role="presentation"
                aria-label={label}
                className={`pointer-events-auto absolute h-3 w-3 rounded-sm border-2 border-primary bg-background ${className}`}
                style={{ cursor }}
                onPointerDown={(event) => startResize(event, box, handle)}
              />
            ))}
          </div>
        );
      })}

      {preview.ghost && (
        <div className="absolute border-2 border-dashed border-primary bg-primary/10" style={boxStyle(docRectToScreen(preview.ghost, view))} aria-hidden>
          {drag?.mode === 'resize' && (
            <span className="absolute -bottom-6 right-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
              {Math.round(preview.ghost.w)} × {Math.round(preview.ghost.h)}
            </span>
          )}
        </div>
      )}
      {preview.line && (
        <div
          className="absolute bg-primary"
          style={(() => {
            const line = docRectToScreen(preview.line!, view);
            return line.w === 0 ? { left: line.x - 1, top: line.y, width: 3, height: Math.max(line.h, 12) } : { left: line.x, top: line.y - 1, width: Math.max(line.w, 12), height: 3 };
          })()}
          aria-hidden
        />
      )}
      {preview.guides.map((guide, index) => {
        const pos = guide.axis === 'x' ? (guide.pos - view.scrollX) * view.zoom : (guide.pos - view.scrollY) * view.zoom;
        return (
          <div
            key={`${guide.axis}-${index}`}
            className="absolute bg-pink-500"
            style={guide.axis === 'x' ? { left: pos, top: 0, bottom: 0, width: 1 } : { top: pos, left: 0, right: 0, height: 1 }}
            aria-hidden
          />
        );
      })}

      {/* While dragging (after the first move: a press alone must leave double clicks to the frame), the iframe must not swallow the pointer. */}
      {drag && preview !== NO_PREVIEW && <div className="pointer-events-auto absolute inset-0" style={{ cursor: drag.mode === 'resize' ? 'nwse-resize' : 'grabbing' }} />}
    </div>
  );
}
